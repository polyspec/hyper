// The recipe check (HYR-8): validates contracts/interfaces.json, runs the three readers, compares them with the spec and
// checks the case results of the five runners (HYR-7). The mutation cases of the readers are no part of a run:
// tests/scripts/recipe-check.test.mts runs them.
// Usage: node scripts/recipe/check.mts [--root <dir>] --php-autoload <autoload.php> [--results <php|node|python|browser|build>=<file>]...
// Prints one `CODE message` line per finding and exits 1 on any.

import path from 'node:path';
import type { Results } from './results.mts';
import { runChecks } from './run.mts';
import type { Counts } from './stated.mts';
import { LANGS, RUNNERS } from './types.mts';
import { validators } from './validators.mts';

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
  // HR-89: the progress goes to the standard error, so the standard output holds the findings alone.
  process.stderr.write(`recipe-check: the three readers read ${root} and the check compares them with contracts/interfaces.json\n`);
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
