#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { texToExcel, xlsx2tex } from './excel.js';
import type { Xlsx2TexOptions } from './models.js';

type ParsedArgs = {
  positionals: string[];
  opts: Record<string, string>;
  help: boolean;
  unknown: string[];
};

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const opts: Record<string, string> = {};
  const unknown: string[] = [];
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      help = true;
      continue;
    }
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }

    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).trim();
    const val = eq >= 0 ? a.slice(eq + 1) : args[i + 1];
    if (!key) {
      unknown.push(a);
      continue;
    }
    if (eq < 0) i += 1;
    if (val == null) {
      unknown.push(a);
      continue;
    }
    opts[key] = val;
  }

  return { positionals, opts, help, unknown };
}

function usage(): string {
  return [
    '用法:',
    '  pubtab xlsx2tex <input> <output> [--config <yaml>] [--sheet <nameOrIndex>] [--caption <text>] [--label <text>] [--position <pos>] [--resizebox <spec>] [--colSpec <spec>] [--headerRows <n>]',
    '  pubtab tex2xlsx <input> <output>',
    '',
    '示例:',
    '  pubtab xlsx2tex table.xlsx out/table.tex --sheet 0 --caption "My Table" --label tab:my --position htbp',
    '  pubtab tex2xlsx table.tex out/table.xlsx',
  ].join('\n');
}

function asSheet(v: string | undefined): string | number | undefined {
  if (v == null) return undefined;
  if (/^\d+$/u.test(v)) return Number(v);
  return v;
}

type ConfigValue = string | number | boolean | null;
type ConfigRecord = Record<string, ConfigValue>;

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function unquoteYamlValue(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseYamlValue(raw: string): ConfigValue {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const unquoted = unquoteYamlValue(trimmed);
  if (unquoted === '') return '';
  if (/^(~|null)$/iu.test(unquoted)) return null;
  if (/^(true|false)$/iu.test(unquoted)) return unquoted.toLowerCase() === 'true';
  if (/^-?\d+$/u.test(unquoted) || /^-?\d+\.\d+$/u.test(unquoted)) return Number(unquoted);
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function parseYamlSimple(content: string): ConfigRecord {
  const result: ConfigRecord = {};
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    const trimmedLine = stripYamlComment(line).trim();
    if (!trimmedLine) continue;
    const idx = trimmedLine.indexOf(':');
    if (idx < 0) {
      throw new Error(`配置解析失败：非法行 ${trimmedLine}`);
    }
    const key = trimmedLine.slice(0, idx).trim();
    const value = trimmedLine.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`配置解析失败：非法键 ${trimmedLine}`);
    }
    result[key] = parseYamlValue(value);
  }
  return result;
}

async function loadYamlConfig(configPath: string): Promise<ConfigRecord> {
  const raw = await fs.readFile(configPath, 'utf8');
  return parseYamlSimple(raw);
}

function fromConfigSheet(v: unknown): string | number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/u.test(v.trim())) return Number(v.trim());
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

function fromConfigHeaderRows(v: unknown): number | 'auto' | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    if (v.trim() === 'auto') return 'auto';
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toXlsx2TexOpts(raw: ConfigRecord, overrides: Record<string, string>): Xlsx2TexOptions {
  const result: Xlsx2TexOptions = {
    sheet: fromConfigSheet(raw.sheet),
    caption: typeof raw.caption === 'string' ? raw.caption : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    position: typeof raw.position === 'string' ? raw.position : undefined,
    resizebox: typeof raw.resizebox === 'string' ? raw.resizebox : undefined,
    colSpec: typeof raw.colSpec === 'string' ? raw.colSpec : undefined,
    headerRows: fromConfigHeaderRows(raw.headerRows),
  };

  if (overrides.sheet != null) {
    result.sheet = asSheet(overrides.sheet);
  }
  if (overrides.caption != null) {
    result.caption = overrides.caption;
  }
  if (overrides.label != null) {
    result.label = overrides.label;
  }
  if (overrides.position != null) {
    result.position = overrides.position;
  }
  if (overrides.resizebox != null) {
    result.resizebox = overrides.resizebox;
  }
  if (overrides.colSpec != null) {
    result.colSpec = overrides.colSpec;
  }
  if (overrides.headerRows != null) {
    const n = fromConfigHeaderRows(overrides.headerRows);
    if (n != null) result.headerRows = n;
  }
  return result;
}

export async function runCli(argv: string[], cwd: string = process.cwd()): Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(usage());
    return 1;
  }

  const { positionals, opts, help, unknown } = parseArgs(args.slice(1));
  if (help) {
    console.log(usage());
    return 1;
  }
  if (unknown.length > 0) {
    console.log(`未知参数: ${unknown.join(' ')}`);
    console.log(usage());
    return 1;
  }
  if (positionals.length < 2) {
    console.log('参数不足。');
    console.log(usage());
    return 1;
  }

  const input = path.resolve(cwd, positionals[0]);
  const output = path.resolve(cwd, positionals[1]);

  try {
    if (cmd === 'xlsx2tex') {
      const configPath = opts.config;
      const config = configPath ? await loadYamlConfig(path.resolve(cwd, configPath)) : {};
      const xlsx2texOpts = toXlsx2TexOpts(config, {
        sheet: opts.sheet,
        caption: opts.caption,
        label: opts.label,
        position: opts.position,
        resizebox: opts.resizebox,
        colSpec: opts.colSpec,
        headerRows: opts.headerRows,
      });
      await xlsx2tex(input, output, xlsx2texOpts);
      return 0;
    }

    if (cmd === 'tex2xlsx') {
      await texToExcel(input, output);
      return 0;
    }

    console.log(`未知命令: ${cmd}`);
    console.log(usage());
    return 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`执行失败: ${msg}`);
    return 2;
  }
}

async function main(): Promise<void> {
  const code = await runCli(process.argv);
  process.exitCode = code;
}

// 允许作为库导入（测试用），同时支持直接作为 bin 运行。
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
