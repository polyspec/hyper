// Tests that a recipe with several checks runs every check to its end and then fails, naming each failed check
// (HR-86): `make hyper-lint` and `make hyper-test-js` run on directories whose checks all fail, and the dry runs of the other
// recipes with several checks show one accumulating command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The command tool `hyper` imports the built modules of the two npm packages, which Git ignores: lib/check.mjs reads
// @polyspec/hyper-client and lib/build.mjs reads @polyspec/hyper/build. A target of the full suite that starts it
// therefore builds both with `make packages` first, in its own recipe or a prerequisite, so that it does not depend on
// a target that happened to run before it (H35.39): a CI group runs its targets on a tree without any dist.
test('every target of the full suite that starts the command tool builds the two npm packages before it (H35.39)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const words = (name: string): string[] => (new RegExp(`^${name} := (.*)$`, 'm').exec(makefile)?.[1] ?? '').split(' ').filter(Boolean).flatMap((word) => (/^\$\(\w+\)$/u.test(word) ? words(word.slice(2, -1)) : [word]));
  const starting: string[] = [];
  const unbuilt: string[] = [];
  for (const target of words('CHECK_TARGETS')) {
    const lines = dryRun(target);
    const start = lines.findIndex((line) => /packages\/cli\/bin\/hyper\.mjs /u.test(line));
    if (start < 0) continue;
    starting.push(target);
    for (const directory of ['packages/client', 'packages/ts']) {
      const built = lines.findIndex((line) => line.startsWith(`cd ${directory} && `) && line.includes(' run --silent build '));
      if (built < 0 || built > start) unbuilt.push(`make ${target} starts the command tool before it builds ${directory} (make packages): ${(lines[start] ?? '').slice(0, 160)}`);
    }
  }
  assert.ok(starting.includes('templates-check'), `the targets that start the command tool: ${starting.join(' ')}`);
  assert.deepEqual(unbuilt, []);
});

function temporary(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-check-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Runs `make <target> <variables>` in the checkout without the variables of a calling make. The tests match the plain
// text of the output, so FORCE_COLOR is removed: tsc colours its output whenever FORCE_COLOR is set, whatever its value.
// NO_COLOR is kept, because tsc and vitest read it as the opt-out.
function make(target: string, variables: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', 'FORCE_COLOR'].includes(name)));
  return spawnSync('make', ['--no-print-directory', target, ...variables], { cwd: ROOT, env, encoding: 'utf8' });
}

test('make hyper-lint runs both formatting checks when the first fails and names both', (t) => {
  const directory = temporary(t);
  const stub = (name: string) => {
    const project = path.join(directory, name);
    mkdirSync(path.join(project, 'vendor', 'bin'), { recursive: true });
    // The stub prints without a final newline, as Pint does.
    writeFileSync(path.join(project, 'vendor', 'bin', 'pint'), `#!/bin/sh\ntouch ${path.join(directory, `${name}.ran`)}\nprintf '${name} is not formatted'\nexit 1\n`);
    chmodSync(path.join(project, 'vendor', 'bin', 'pint'), 0o755);
    return project;
  };
  const packageProject = stub('package');
  const boardProject = stub('board');
  const run = make('hyper-lint', [`PHP_PACKAGE=${packageProject}`, `PHP_VENDOR=${path.join(packageProject, 'vendor')}`, `BOARD=${boardProject}`]);
  assert.notEqual(run.status, 0);
  assert.ok(existsSync(path.join(directory, 'package.ran')) && existsSync(path.join(directory, 'board.ran')), run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`failed checks: Pint of ${packageProject}; Pint of ${boardProject};`));
  // Every line of the recipe starts at column 0, after output without a final newline too (HR-84).
  const lines = run.stdout.split('\n');
  assert.ok(lines.includes('package is not formatted'), run.stdout);
  assert.ok(lines.includes(`cd ${boardProject} && vendor/bin/pint --test app src public`), run.stdout);
  assert.ok(lines.includes('board is not formatted'), run.stdout);
  assert.ok(lines.some((line) => line.startsWith('failed checks:')), run.stdout);
});

test('make hyper-test-js runs the type check when the tests fail and names both', (t) => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  const directory = temporary(t);
  writeFileSync(path.join(directory, 'fails.test.mjs'), "import { test, expect } from 'vitest';\ntest('fails', () => expect(1).toBe(2));\n");
  writeFileSync(path.join(directory, 'wrong.ts'), "export const value: number = 'text';\n");
  writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ['wrong.ts'] }));
  const run = make('hyper-test-js', [`JS_PACKAGE=${directory}`, 'JS_TESTS=fails.test.mjs']);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /✖ vitest: 0 passed, 1 failed/);
  assert.match(`${run.stdout}${run.stderr}`, /wrong\.ts\(1,14\): error TS2322/);
  assert.match(run.stdout, new RegExp(`failed checks: the tests of ${directory}; the type check of ${directory};`));
});

// A recipe passes only options that the script it starts declares: node:util parseArgs throws for an unknown option, so
// an option renamed in one place fails the target at its start, as `--php-extension` (the option of the test runner of the
// kit) did for scripts/check-parity.mts, whose option is `--extension`.
test('make packages leaves no staging directory when a build fails (HR-87)', (t) => {
  const directory = temporary(t);
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  mkdirSync(first);
  mkdirSync(second);
  // The stub stands for `npm run build -- --outDir <staging>`: it writes the staging directory that its last argument
  // names, and fails in the second package, after the first package was built and published.
  const npm = path.join(directory, 'npm');
  writeFileSync(npm, '#!/bin/sh\nfor argument; do staging=$argument; done\nmkdir -p "$staging" && echo built > "$staging/index.js"\ncase "$PWD" in */second) exit 1;; esac\n');
  chmodSync(npm, 0o755);
  const result = make('packages', [`JS_PACKAGE=${first}`, `NODE_PACKAGE=${second}`, `NPM=${npm}`]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readdirSync(first), ['dist'], 'the first package holds only its published output');
  assert.equal(readFileSync(path.join(first, 'dist/index.js'), 'utf8'), 'built\n');
  assert.deepEqual(readdirSync(second), [], 'the failed build left its staging directory');
});

test('every option that a recipe passes to a script of scripts/ is declared by that script', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const found: string[] = [];
  let checked = 0;
  for (const [, script, rest] of makefile.matchAll(/\$\(NODE\) scripts\/([\w-]+\.mts)([^\n]*)/g)) {
    if (script === undefined || rest === undefined) throw new Error('the pattern of a script recipe matched without its groups');
    const source = readFileSync(path.join(ROOT, 'scripts', script), 'utf8');
    if (!source.includes('parseArgs(')) continue;
    const declared = new Set([...source.matchAll(/['"]?([a-z][\w-]*)['"]?:\s*\{\s*type:/g)].map((match) => match[1]));
    // The options after `--` belong to the command that the script runs, not to the script. An option is a name or a
    // variable of make joined to `--`, such as `--$(NODE)`, which no script declares (H35.66).
    const own = rest.split(' -- ')[0] ?? rest;
    for (const [, option] of own.matchAll(/(?:^|\s)--(\$\([^)]*\)|[\w-]+)/g)) {
      checked += 1;
      if (!declared.has(option)) found.push(`scripts/${script} does not declare --${option}; it declares ${[...declared].map((name) => `--${name}`).join(', ')}`);
    }
  }
  assert.ok(checked > 10, `only ${checked} options were checked`);
  assert.deepEqual(found, []);
});

/**
 * A Makefile of the rules of recipe-check as the Makefile of the checkout holds them: `check` and `checks_result`, and
 * the rules from the case runners to recipe-check, each without its prerequisites, which build what the real runners
 * read and a stub runner does not.
 */
function recipeCheckRules(): string {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const macros = makefile.split('\n').filter((line) => /^(?:check|checks_result) = /u.test(line));
  assert.equal(macros.length, 2, 'the Makefile defines check and checks_result');
  const start = makefile.indexOf('\n.PHONY: recipe-check ');
  const end = makefile.indexOf('\nrecipe-candidates:');
  assert.ok(start >= 0 && end > start, 'the Makefile holds the rules of recipe-check before recipe-candidates');
  const rules = makefile.slice(start, end);
  assert.match(rules, /^recipe-check:/mu, 'the rules hold recipe-check');
  return `${macros.join('\n')}\n${rules.replace(/^(recipe-[\w-]+):[^#\n]*/gmu, '$1: ')}\n`;
}

test('make recipe-check runs every case runner and the comparison after a failed runner, each line at column 0, and names the failed runners at its end (HR-84, HR-86)', (t) => {
  const directory = temporary(t);
  writeFileSync(path.join(directory, 'Makefile'), recipeCheckRules());
  // The recipe starts scripts/line-end.mts by that path, so the directory holds it; it imports only modules of node.
  mkdirSync(path.join(directory, 'scripts'));
  copyFileSync(path.join(ROOT, 'scripts/line-end.mts'), path.join(directory, 'scripts/line-end.mts'));
  // The program `node` of this run: it runs scripts/line-end.mts with the node of this test, and stands for every other
  // command, which it records. The PHP and the Python case runner fail and print without a final newline.
  const bin = path.join(directory, 'bin');
  const record = path.join(directory, 'started');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), [
    '#!/bin/sh',
    `case "$1" in scripts/line-end.mts) exec '${process.execPath}' "$@";; esac`,
    `printf '%s\\n' "$*" >> '${record}'`,
    'case "$*" in',
    "  *CaseRunnerTest*) printf 'the PHP runner failed'; exit 1;;",
    "  *test_case_runner.py*) printf 'the Python runner failed'; exit 1;;",
    "  *) echo 'passed';;",
    'esac',
    '',
  ].join('\n'));
  chmodSync(path.join(bin, 'node'), 0o755);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name)));
  const variables = [`NODE=${path.join(bin, 'node')}`, 'KIT=kit', 'KIT_EXT=mjs', `RECIPE_RESULTS_DIR=${path.join(directory, 'results')}`, `RECIPE_TYPESCRIPT=${directory}`, 'PHP_PACKAGE=packages/php', 'NODE_PACKAGE=packages/ts', 'JS_PACKAGE=packages/client', 'PYTHON_PACKAGE=packages/python'];
  const run = spawnSync('make', ['--no-print-directory', 'recipe-check', ...variables], { cwd: directory, env: { ...env, PATH: `${bin}:${env.PATH ?? ''}` }, encoding: 'utf8' });
  const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
  assert.notEqual(run.status, 0, output);
  // Every runner ran after the failed PHP runner, and the comparison after the failed Python runner (HR-86).
  const started = existsSync(record) ? readFileSync(record, 'utf8').trimEnd().split('\n') : [];
  const expected = ['--filter CaseRunnerTest', '--cwd packages/ts -- tests/case-runner.test.ts', 'test_case_runner.py', '--cwd packages/client -- tests/case-runner.test.ts', 'tests/scripts/build-id.test.mts', 'scripts/recipe/check.mts --root .'];
  assert.equal(started.length, expected.length, `${started.join('\n')}\n${output}`);
  expected.forEach((part, index) => assert.ok(started[index]?.includes(part), `command ${index + 1} is "${part}":\n${started.join('\n')}`));
  // The output of a runner that ends without a newline is a line of its own (HR-84).
  const lines = run.stdout.trimEnd().split('\n');
  assert.ok(lines.includes('the PHP runner failed'), output);
  assert.ok(lines.includes('the Python runner failed'), output);
  // The last line names each failed runner, after the output of the comparison (HR-86).
  assert.equal(lines.at(-1), 'failed checks: the PHP case runner; the Python case runner;', output);
});
