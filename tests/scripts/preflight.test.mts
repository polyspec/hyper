// make preflight (H35.111): the targets of the CI groups that the checkout runs with its own processes (H35.92), run to
// their ends by the report runner of kit (HR-86), and the names of what only CI runs. A target that needs what the
// checkout cannot provide declares it, `CI_NEEDS_<target> := browser|container|redis`, and the preflight skips it. The
// test reads the dry runs of the targets (HR-83) and the scripts that they start, and derives what it expects from the
// CI groups and the declarations of the Makefile and from the files of tests/scripts.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

type Need = 'browser' | 'container' | 'redis';
const NEEDS: Need[] = ['browser', 'container', 'redis'];
const isNeed = (word: string): word is Need => NEEDS.some((need) => need === word);

/** The declarations `CI_NEEDS_<target> := <need>...` of the Makefile. */
const declared = new Map([...makefile.matchAll(/^CI_NEEDS_([\w-]+) := (.*)$/gmu)].map((m) => [m[1] ?? '', (m[2] ?? '').split(' ').filter(Boolean)]));

const groups = words('CI_GROUPS');
const measure = words('CI_GROUPS_MEASURE');
const checked = groups.filter((group) => !measure.includes(group));
const expected = checked.flatMap((group) => words(`CI_TARGETS_${group}`)).filter((target) => !declared.has(target));
const measured = measure.flatMap((group) => words(`CI_TARGETS_${group}`));
/** Every target that a check of the repository runs: the full suite, its Darwin part and every CI group. */
const targets = [...new Set([...words('CHECK_TARGETS'), ...words('DARWIN_TARGETS'), ...groups.flatMap((group) => words(`CI_TARGETS_${group}`))])];

// A test that starts a Redis server imports the server of tests/scripts/session-redis-server.mts; a file that only names it
// in a text, as this one does, is no such test.
const REDIS_IMPORT = "from './session-redis-server" + ".mts'";
const scripts = readdirSync(path.join(ROOT, 'tests', 'scripts')).filter((name) => name.endsWith('.test.mts')).sort();
const startsRedis = (name: string): boolean => readFileSync(path.join(ROOT, 'tests', 'scripts', name), 'utf8').includes(REDIS_IMPORT);
const redis = scripts.filter(startsRedis).map((name) => `tests/scripts/${name}`);
const local = scripts.filter((name) => !startsRedis(name)).map((name) => `tests/scripts/${name}`);

// What reaches each need, in a command line of a dry run or in a script that a command line names.
const REACHES: Record<Need, { line: RegExp; source: RegExp }> = {
  browser: { line: /\bplaywright\b|run-e2e\.mts/u, source: /from ['"](?:@playwright\/test|playwright)['"]|chromium\.launch/u },
  container: { line: /(?:^|[\s;&|])(?:container|bay) /u, source: /spawn(?:Sync)?\(['"](?:container|bay)['"]/u },
  redis: { line: /redis-server/u, source: /session-redis-server\.mts['"]|['"]redis-server['"]/u },
};

/** The script files that a command line names, a directory as its .mts files; the test files of tests/scripts are left out, because the import rule above selects them. */
function scriptsOf(line: string): string[] {
  return line.split(/[\s'"=]+/u).filter((word) => /\.(?:mts|ts|php|py)$|\/$/u.test(word)).flatMap((word) => {
    const file = path.resolve(ROOT, word);
    if (!file.startsWith(ROOT) || !existsSync(file)) return [];
    if (statSync(file).isDirectory()) return readdirSync(file).filter((name) => name.endsWith('.mts')).map((name) => path.join(file, name));
    return /^tests\/scripts\/[^/]+\.test\.mts$/u.test(path.relative(ROOT, file)) ? [] : [file];
  });
}

/** The needs that the dry run of `target` reaches, with the line or the file that reaches each. */
function reached(target: string): Map<Need, string> {
  const found = new Map<Need, string>();
  for (const line of dryRun(target)) {
    for (const need of NEEDS) if (!found.has(need) && REACHES[need].line.test(line)) found.set(need, line);
    for (const file of scriptsOf(line)) {
      const text = readFileSync(file, 'utf8');
      for (const need of NEEDS) if (!found.has(need) && REACHES[need].source.test(text)) found.set(need, path.relative(ROOT, file));
    }
  }
  return found;
}

/** The lines of the dry run of make preflight, and its line that runs the report runner into var/report/preflight. */
function preflight(): { lines: string[]; run: string } {
  const lines = dryRun('preflight');
  const run = lines.find((line) => line.includes('ci-targets') && line.includes('var/report/preflight'));
  assert.ok(run !== undefined, `make preflight runs no ci-targets into var/report/preflight: ${lines.join('\n')}`);
  return { lines, run };
}

test('each declared need of a target is one of browser, container and redis, and the target reaches it (H35.111)', () => {
  assert.ok(declared.size > 0, 'the Makefile declares no CI_NEEDS_<target>');
  for (const [target, needs] of declared) {
    assert.ok(needs.length > 0, `CI_NEEDS_${target} declares no need`);
    const found = reached(target);
    for (const need of needs) {
      assert.ok(isNeed(need), `CI_NEEDS_${target} declares ${need}, which is none of ${NEEDS.join(', ')}`);
      assert.ok(found.has(need), `CI_NEEDS_${target} declares ${need}, and the dry run of make ${target} does not reach it`);
    }
  }
});

test('a target of a check that reaches a browser, a container or a Redis server declares it (H35.111, H35.92)', () => {
  for (const target of targets) {
    const needs = declared.get(target) ?? [];
    for (const [need, where] of reached(target)) {
      assert.ok(needs.includes(need), `make ${target} reaches ${need} through ${where}, and the Makefile declares no CI_NEEDS_${target} with it`);
    }
  }
});

test('make preflight runs the undeclared targets of every CI group that is no measurement group, past failures (H35.111, HR-86)', () => {
  const { run } = preflight();
  assert.ok(expected.length > 0, 'the CI groups of the Makefile name no target');
  assert.match(run, / -k var\/report\/preflight /u, 'make preflight does not run every target to its end');
  const listed = run.slice(run.indexOf('var/report/preflight') + 'var/report/preflight'.length).split(' ').filter(Boolean);
  assert.deepEqual(listed, expected, 'make preflight runs other targets than the undeclared ones of the CI groups');
});

test('make preflight runs hyper-test-scripts without the tests that start a Redis server (H35.111, H35.92)', () => {
  assert.ok(redis.length > 0, 'no test of tests/scripts starts a Redis server, so the selection is not shown');
  assert.ok(local.includes('tests/scripts/preflight.test.mts'), 'a file that names the Redis server only in a text counts as a test that starts it');
  const { run } = preflight();
  const selection = /TESTS='([^']*)'/u.exec(run)?.[1];
  assert.ok(selection !== undefined, `make preflight passes no TESTS to its runner: ${run}`);
  assert.deepEqual(selection.split(' ').filter(Boolean).sort(), local, 'make preflight selects other test files than those that start no Redis server');
});

test('make preflight names what only CI runs before it runs (H35.111, H35.92)', () => {
  const { lines, run } = preflight();
  const printed = lines.slice(0, lines.indexOf(run)).join('\n');
  for (const name of [...declared.keys(), ...measured, ...redis]) {
    assert.ok(printed.includes(name), `make preflight does not name ${name} as skipped before its run: ${printed}`);
  }
});
