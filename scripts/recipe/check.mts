// The recipe check (HYR-8): validates contracts/interfaces.json, runs the three readers, compares them with the spec and
// checks the case results of the five runners (HYR-7). The mutation cases of the readers are no part of a run:
// tests/scripts/recipe-check.test.mts runs them.
// Usage: node scripts/recipe/check.mts [--root <dir>] --php-autoload <autoload.php> --run-dir <dir> [--cargo <command>]
// The cargo command, the CARGO of the Makefile, finds the interface.json of a library that a reexport names (HYR-5).
// The run directory holds the results that this run wrote, one file per runner (H35.144); no other directory is read.
// Prints one `CODE message` line per finding and exits 1 on any.

import path from 'node:path';
import { report, runCommand } from './exit.mts';
import type { Results } from './results.mts';
import { runChecks } from './run.mts';
import type { Counts } from './stated.mts';
import { LANGS, RUNNERS } from './types.mts';
import { validators } from './validators.mts';

function argumentOf(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The result file of each runner in the run directory `--run-dir`: `<runner>.txt`, which this run's runner writes. */
function resultArguments(): Results {
  const runDir = argumentOf('--run-dir');
  if (runDir === undefined) throw new Error('--run-dir <dir> is required: the directory of the results that this run wrote');
  const out: Results = {};
  for (const runner of RUNNERS) out[runner] = path.resolve(runDir, `${runner}.txt`);
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
  const cargo = (argumentOf('--cargo') ?? '').split(' ').filter((w) => w !== '');
  const findings = runChecks(root, v, resultArguments(), path.resolve(phpAutoload), counts, cargo);
  // HYR-8: a run that passes prints the three numbers of HYR-5.
  return report(
    findings.map((f) => `${f.code} ${f.message}`),
    `recipe-check: ${LANGS.length} languages agree with the spec; ${counts.direct} members stated directly, ${counts.internal} internal and ${counts.private} private members stated through their callers`,
  );
}

runCommand(main);
