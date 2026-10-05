// The commands that make would run for a target, read without the context of the calling process (HY-83): a make
// that runs inside another make, or with -w or -C, prints the lines "make: Entering directory" and "Leaving directory"
// around the commands, so the dry run starts make without the variables of a calling make and with
// --no-print-directory, and returns only the command lines.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CALLER = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];

/** The command lines of `make -n <target> <variables>` in `cwd`, whatever make called this process. */
export function dryRun(target, { variables = [], cwd = ROOT, env = process.env } = {}) {
  const clean = Object.fromEntries(Object.entries(env).filter(([name]) => !CALLER.includes(name)));
  const result = spawnSync('make', ['--no-print-directory', '-n', target, ...variables], { cwd, encoding: 'utf8', env: clean });
  assert.equal(result.status, 0, `make -n ${target}: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}
