// The recipe check (HYR-8): runs the readers' mutation cases, then validates contracts/interfaces.json, runs the three
// readers, compares them with the spec and checks the case results of the five runners (HYR-7).
// Usage: node scripts/recipe/check.mts [--root <dir>] --php-autoload <autoload.php> [--results <php|node|python|browser|build>=<file>]... [--no-selftest]
// Prints one `CODE message` line per finding and exits 1 on any.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Results } from './results.mts';
import { runChecks } from './run.mts';
import { selfTest } from './selftest.mts';
import type { Counts } from './stated.mts';
import { LANGS, RUNNERS } from './types.mts';
import { validators } from './validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', '..', 'tests', 'scripts', 'fixtures', 'recipe');

function argumentOf(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The `--results <runner>=<file>` arguments, one per runner. */
function resultArguments(): Results {
  const out: Results = {};
  process.argv.forEach((arg, i) => {
    if (arg !== '--results') return;
    const value = process.argv[i + 1] ?? '';
    const runner = RUNNERS.find((r) => value.startsWith(`${r}=`));
    if (runner === undefined) throw new Error(`--results takes <php|node|python|browser|build>=<file>, got ${value}`);
    out[runner] = path.resolve(value.slice(runner.length + 1));
  });
  return out;
}

function main(): number {
  const root = path.resolve(argumentOf('--root') ?? process.cwd());
  const phpAutoload = argumentOf('--php-autoload');
  if (phpAutoload === undefined) throw new Error('--php-autoload <autoload.php> is required');
  const v = validators();

  if (!process.argv.includes('--no-selftest')) {
    const failures = selfTest(fixture, v);
    for (const line of failures) process.stdout.write(`${line}\n`);
    if (failures.length > 0) return 1;
  }

  const counts: Counts = { direct: 0, internal: 0, private: 0 };
  const findings = runChecks(root, v, resultArguments(), path.resolve(phpAutoload), counts);
  for (const f of findings) process.stdout.write(`${f.code} ${f.message}\n`);
  if (findings.length === 0) {
    // HYR-8: a run that passes prints the three numbers of HYR-5.
    process.stdout.write(
      `recipe-check: ${LANGS.length} languages agree with the spec; ${counts.direct} members stated directly, ${counts.internal} internal and ${counts.private} private members stated through their callers\n`,
    );
  }
  return findings.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
