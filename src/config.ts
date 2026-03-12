import fs from 'node:fs/promises';
import YAML from 'yaml';

import type { SpacingConfig } from './models.js';

export type ConfigValue = string | number | boolean | null | string[] | Record<string, unknown> | SpacingConfig;
export type ConfigRecord = Record<string, ConfigValue>;

const ROOT_TYPE_ERROR = 'Config YAML root must be a mapping';
const INVALID_KEY_ERROR = '配置解析失败';
const VALID_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

type YamlNode = {
  items?: Array<{ key?: { value?: unknown }; value?: YamlNode }>;
  value?: unknown;
  source?: string;
};

function unquoteYamlValue(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    return s.slice(1, -1);
  }
  return s;
}

function scalarFromSource(source: string | undefined, fallback: unknown): string | number | boolean | null {
  if (typeof source !== 'string') {
    if (fallback == null || typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean') {
      return fallback ?? null;
    }
    return String(fallback);
  }

  const trimmed = source.trim();
  const unquoted = unquoteYamlValue(trimmed);
  if (unquoted === '') return '';
  if (/^(~|null)$/iu.test(unquoted)) return null;
  if (/^(true|false)$/iu.test(unquoted)) return unquoted.toLowerCase() === 'true';
  return unquoted;
}

function isYamlMap(node: YamlNode | null | undefined): node is YamlNode & { items: NonNullable<YamlNode['items']> } {
  return Boolean(node && node.constructor?.name === 'YAMLMap' && Array.isArray(node.items));
}

function isYamlSeq(node: YamlNode | null | undefined): node is YamlNode & { items: YamlNode[] } {
  return Boolean(node && node.constructor?.name === 'YAMLSeq' && Array.isArray(node.items));
}

function nodeToValue(node: YamlNode | null | undefined, preserveScalarSource: boolean): unknown {
  if (isYamlMap(node)) return nodeToObject(node, preserveScalarSource);
  if (isYamlSeq(node)) {
    return node.items.map((item) => nodeToValue(item, preserveScalarSource));
  }
  return scalarFromSource(
    preserveScalarSource ? node?.source : undefined,
    node?.value,
  );
}

function nodeToObject(node: YamlNode | null | undefined, preserveScalarSource: boolean): Record<string, unknown> {
  if (!isYamlMap(node)) return {};

  const result: Record<string, unknown> = {};
  for (const pair of node.items) {
    const rawKey = pair?.key?.value;
    if (typeof rawKey !== 'string' || !VALID_KEY_RE.test(rawKey)) {
      throw new Error(`${INVALID_KEY_ERROR}：非法键 ${String(rawKey ?? '')}`);
    }

    const valueNode = pair?.value;
    result[rawKey] = nodeToValue(valueNode, preserveScalarSource);
  }
  return result;
}

function pick<T>(raw: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key] as T;
  }
  return undefined;
}

function normalizeSpacing(raw: unknown): SpacingConfig | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const source = raw as Record<string, unknown>;
  const spacing: SpacingConfig = {};
  for (const key of ['tabcolsep', 'arraystretch', 'heavyrulewidth', 'lightrulewidth', 'arrayrulewidth', 'aboverulesep', 'belowrulesep'] as const) {
    const value = source[key];
    if (value == null || value === '') continue;
    spacing[key] = typeof value === 'string' ? value : String(value);
  }

  return Object.keys(spacing).length > 0 ? spacing : undefined;
}

function normalizeConfig(raw: Record<string, unknown>): ConfigRecord {
  const result: ConfigRecord = {};

  const assign = (key: keyof ConfigRecord, value: ConfigValue | undefined): void => {
    if (value !== undefined) result[key] = value;
  };

  assign('theme', pick<string>(raw, 'theme'));
  assign('caption', pick<string>(raw, 'caption'));
  assign('label', pick<string>(raw, 'label'));
  assign('position', pick<string>(raw, 'position'));
  assign('resizebox', pick<string>(raw, 'resizebox'));
  assign('sheet', pick<string | number>(raw, 'sheet'));
  assign('headerRows', pick<number | string>(raw, 'headerRows', 'header_rows'));
  assign('spanColumns', pick<boolean>(raw, 'spanColumns', 'span_columns'));
  assign('fontSize', pick<string>(raw, 'fontSize', 'font_size'));
  assign('colSpec', pick<string>(raw, 'colSpec', 'col_spec'));
  assign('headerSep', pick<string | string[]>(raw, 'headerSep', 'header_sep'));
  assign('numCols', pick<number | string>(raw, 'numCols', 'num_cols'));

  const spacing = normalizeSpacing(pick<Record<string, unknown>>(raw, 'spacing'));
  if (spacing) result.spacing = spacing;

  return result;
}

function isRootMapping(doc: YAML.Document.Parsed): boolean {
  return isYamlMap(doc.contents as YamlNode | null | undefined);
}

export async function loadConfig(path: string): Promise<[ConfigRecord, null]> {
  const raw = await fs.readFile(path, 'utf8');
  if (!raw.trim()) {
    return [{}, null];
  }

  const doc = YAML.parseDocument(raw, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw doc.errors[0];
  }
  if (!isRootMapping(doc)) {
    throw new Error(`${ROOT_TYPE_ERROR}; mapping object required.`);
  }

  const parsed = nodeToObject(doc.contents as YamlNode, false);
  const spacingNode = (doc.contents as YamlNode).items?.find((pair) => pair?.key?.value === 'spacing')?.value as YamlNode | undefined;
  if (spacingNode) {
    parsed.spacing = nodeToObject(spacingNode, true);
  }

  return [normalizeConfig(parsed), null];
}
