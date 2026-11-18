// make preflight (H35.111): the targets of the CI groups that the checkout runs with its own processes (H35.92), run to
// their ends by the report runner of kit (HR-86), and the names of what only CI runs. The test reads the dry run of the
// target (HR-83) and derives what it expects from the CI groups of the Makefile and from the files of tests/scripts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');

/** The words of the Makefile variable `name`, with each word `$(VARIABLE)` replaced by the words of that variable. */
function words(name: string): string[] {
  const value = new RegExp(`^${name} := (.*)$`, 'm').exec(makefile)?.[1];
  if (value === undefined) throw new Error(`the Makefile declares no ${name}`);
  return value.split(' ').filter(Boolean).flatMap((word) => {
    const variable = /^\$\((\w+)\)$/.exec(word)?.[1];
    return variable === undefined ? [word] : words(variable);
  });
}

const measure = words('CI_GROUPS_MEASURE');
const checked = words('CI_GROUPS').filter((group) => !measure.includes(group));
const ciOnly = ['e2e', 'parity'];
const expected = checked.flatMap((group) => words(`CI_TARGETS_${group}`)).filter((target) => !ciOnly.includes(target));
const measured = measure.flatMap((group) => words(`CI_TARGETS_${group}`));

const scripts = readdirSync(path.join(ROOT, 'tests', 'scripts')).filter((name) => name.endsWith('.test.mts')).sort();
const startsRedis = (name: string): boolean => readFileSync(path.join(ROOT, 'tests', 'scripts', name), 'utf8').includes('session-redis-server.mts');
const redis = scripts.filter(startsRedis).map((name) => `tests/scripts/${name}`);
const local = scripts.filter((name) => !startsRedis(name)).map((name) => `tests/scripts/${name}`);

/** The lines of the dry run of make preflight, and its line that runs the report runner into var/report/preflight. */
function preflight(): { lines: string[]; run: string } {
  const lines = dryRun('preflight');
  const run = lines.find((line) => line.includes('ci-targets') && line.includes('var/report/preflight'));
  assert.ok(run !== undefined, `make preflight runs no ci-targets into var/report/preflight: ${lines.join('\n')}`);
  return { lines, run };
}

test('make preflight runs the targets of every CI group that is no measurement group, past failures (H35.111, HR-86)', () => {
  const { run } = preflight();
  assert.ok(expected.length > 0, 'the CI groups of the Makefile name no target');
  assert.match(run, / -k var\/report\/preflight /u, 'make preflight does not run every target to its end');
  const targets = run.slice(run.indexOf('var/report/preflight') + 'var/report/preflight'.length).split(' ').filter(Boolean);
  assert.deepEqual(targets, expected, 'make preflight runs other targets than those of the CI groups');
});

test('make preflight runs hyper-test-scripts without the tests that start a Redis server (H35.111, H35.92)', () => {
  assert.ok(redis.length > 0, 'no test of tests/scripts starts a Redis server, so the selection is not shown');
  const { run } = preflight();
  const selection = /TESTS='([^']*)'/u.exec(run)?.[1];
  assert.ok(selection !== undefined, `make preflight passes no TESTS to its runner: ${run}`);
  assert.deepEqual(selection.split(' ').filter(Boolean).sort(), local, 'make preflight selects other test files than those that start no Redis server');
});

test('make preflight names what only CI runs before it runs (H35.111, H35.92)', () => {
  const { lines, run } = preflight();
  const printed = lines.slice(0, lines.indexOf(run)).join('\n');
  for (const name of [...ciOnly, ...measured, ...redis]) {
    assert.ok(printed.includes(name), `make preflight does not name ${name} as skipped before its run: ${printed}`);
  }
});
