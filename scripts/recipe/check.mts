// The recipe check (HYR-8): runs the readers' mutation cases, then validates contracts/interfaces.json, runs the three
// readers, compares them with the spec and checks the case results (HYR-7).
// Usage: node scripts/recipe/check.mts [--root <dir>] [--results <php|node|python>=<file>]... [--no-selftest]
// Prints one `CODE message` line per finding and exits 1 on any.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Results } from './results.mts';
import { runChecks } from './run.mts';
import { selfTest } from './selftest.mts';
import { LANGS } from './types.mts';
import { validators } from './validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', '..', 'tests', 'scripts', 'fixtures', 'recipe');

function argumentOf(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The `--results <lang>=<file>` arguments, one per language. */
function resultArguments(): Results {
  const out: Results = {};
  process.argv.forEach((arg, i) => {
    if (arg !== '--results') return;
    const value = process.argv[i + 1] ?? '';
    const lang = LANGS.find((l) => value.startsWith(`${l}=`));
    if (lang === undefined) throw new Error(`--results takes <php|node|python>=<file>, got ${value}`);
    out[lang] = path.resolve(value.slice(lang.length + 1));
  });
  return out;
}

function main(): number {
  const root = path.resolve(argumentOf('--root') ?? process.cwd());
  const v = validators();

  if (!process.argv.includes('--no-selftest')) {
    const failures = selfTest(fixture, v);
    for (const line of failures) process.stdout.write(`${line}\n`);
    if (failures.length > 0) return 1;
  }

  const findings = runChecks(root, v, resultArguments());
  for (const f of findings) process.stdout.write(`${f.code} ${f.message}\n`);
  if (findings.length === 0) process.stdout.write(`recipe-check: ${LANGS.length} languages agree with the spec\n`);
  return findings.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
