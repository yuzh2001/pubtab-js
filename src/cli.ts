#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { texToExcel, xlsx2tex } from './excel.js';

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
    '  pubtab xlsx2tex <input> <output> [--sheet <nameOrIndex>] [--caption <text>] [--label <text>] [--position <pos>] [--resizebox <spec>] [--colSpec <spec>] [--headerRows <n>]',
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

function asNumber(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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
      const xlsx2texOpts: any = {
        sheet: asSheet(opts.sheet),
        caption: opts.caption,
        label: opts.label,
        position: opts.position,
        resizebox: opts.resizebox,
        colSpec: opts.colSpec,
      };
      if (opts.headerRows != null) {
        const n = asNumber(opts.headerRows);
        xlsx2texOpts.headerRows = n ?? opts.headerRows;
      }
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
