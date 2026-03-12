import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import type { SpacingConfig } from './models.js';

export interface ThemeConfig {
  name: string;
  description: string;
  packages: string[];
  captionPosition: 'top' | 'bottom';
  fontSize: string | null;
  columnSep: string;
  spacing: Required<SpacingConfig>;
}

type RawThemeConfig = {
  name?: unknown;
  description?: unknown;
  packages?: unknown;
  column_sep?: unknown;
  font_size?: unknown;
  caption_position?: unknown;
  spacing?: Record<string, unknown> | null;
};

const DEFAULT_THEME = 'three_line';
const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const THEME_CACHE = new Map<string, ThemeConfig>();

function normalizeSpacing(raw: Record<string, unknown> | null | undefined): Required<SpacingConfig> {
  const spacing = raw ?? {};
  return {
    tabcolsep: typeof spacing.tabcolsep === 'string' ? spacing.tabcolsep : null,
    arraystretch: typeof spacing.arraystretch === 'string' ? spacing.arraystretch : null,
    heavyrulewidth: typeof spacing.heavyrulewidth === 'string' ? spacing.heavyrulewidth : '1.0pt',
    lightrulewidth: typeof spacing.lightrulewidth === 'string' ? spacing.lightrulewidth : '0.5pt',
    arrayrulewidth: typeof spacing.arrayrulewidth === 'string' ? spacing.arrayrulewidth : '0.5pt',
    aboverulesep: typeof spacing.aboverulesep === 'string' ? spacing.aboverulesep : '0pt',
    belowrulesep: typeof spacing.belowrulesep === 'string' ? spacing.belowrulesep : '0pt',
  };
}

function loadThemeConfig(name: string): ThemeConfig {
  const configPath = path.join(THEMES_DIR, name, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Theme '${name}' not found. Available: ${listThemes().join(', ')}`);
  }

  const raw = YAML.parse(fs.readFileSync(configPath, 'utf8')) as RawThemeConfig | null;
  if (!raw || typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error(`Theme '${name}' has invalid config`);
  }

  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    packages: Array.isArray(raw.packages)
      ? raw.packages.filter((pkg): pkg is string => typeof pkg === 'string')
      : [],
    columnSep: typeof raw.column_sep === 'string' ? raw.column_sep : '1em',
    fontSize: typeof raw.font_size === 'string' ? raw.font_size : null,
    captionPosition: raw.caption_position === 'bottom' ? 'bottom' : 'top',
    spacing: normalizeSpacing(raw.spacing),
  };
}

export { DEFAULT_THEME };

export function listThemes(): string[] {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(THEMES_DIR, entry.name, 'config.yaml')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function getTheme(name: string | undefined | null): ThemeConfig {
  const resolvedName = (name == null || !String(name).trim()) ? DEFAULT_THEME : String(name).trim();
  const cached = THEME_CACHE.get(resolvedName);
  const theme = cached ?? loadThemeConfig(resolvedName);
  if (!cached) THEME_CACHE.set(resolvedName, theme);
  return {
    ...theme,
    packages: [...theme.packages],
    spacing: { ...theme.spacing },
  };
}
