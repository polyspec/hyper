// Tests that a recipe with several checks runs every check to its end and then fails, naming each failed check
// (HR-86): `make hyper-lint` and `make hyper-test-js` run on directories whose checks all fail, and the dry runs of the other
// recipes with several checks show one accumulating command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function temporary(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-check-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Runs `make <target> <variables>` in the checkout without the variables of a calling make. The tests match the plain
// text of the output, so FORCE_COLOR is removed: tsc colours its output whenever FORCE_COLOR is set, whatever its value.
// NO_COLOR is kept, because tsc and vitest read it as the opt-out.
// The recipes under test list toolchain-check as a prerequisite, which fails on a machine whose tools differ from the declared
// ones; the test checks how a recipe accumulates failures, so `-o toolchain-check` leaves that prerequisite to its own gate.
function make(target: string, variables: string[], extra: Record<string, string> = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', 'FORCE_COLOR'].includes(name)));
  return spawnSync('make', ['--no-print-directory', '-o', 'toolchain-check', target, ...variables], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8' });
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
  // The runner of the kit runs a vitest run without a selection only in CI; the directory holds the one failing test.
  const run = make('hyper-test-js', [`JS_PACKAGE=${directory}`], { GITHUB_ACTIONS: 'true' });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /✖ vitest: 0 passed, 1 failed/);
  assert.match(`${run.stdout}${run.stderr}`, /wrong\.ts\(1,14\): error TS2322/);
  assert.match(run.stdout, new RegExp(`failed checks: the tests of ${directory}; the type check of ${directory};`));
});

test('every other recipe with several checks runs them in one accumulating command', () => {
  const recipes: [string, number][] = [['hyper-test-node', 2], ['hyper-test-php', 2], ['parity', 2], ['bench-server', 2]];
  for (const [target, checks] of recipes) {
    const lines = dryRun(target, { variables: ['TEMPLATE_DIR=var/products/template'] });
    const start = lines.findLastIndex((line) => line === 'failed=; \\');
    assert.ok(start >= 0, `${target}:\n${lines.join('\n')}`);
    const recipe = lines.slice(start);
    assert.equal(recipe.filter((line) => line.includes("node scripts/line-end.mts '") && line.includes(' || failed="$failed ')).length, checks, `${target}:\n${recipe.join('\n')}`);
    const last = recipe.at(-1);
    assert.ok(last !== undefined, `${target}: the recipe has no line`);
    assert.match(last, /test -z "\$failed" \|\| \{ echo "failed checks:\$failed"; exit 1; \}/, target);
  }
});

// A recipe passes only options that the script it starts declares: node:util parseArgs throws for an unknown option, so
// an option renamed in one place fails the target at its start, as `--php-extension` (the option of the test runner of the
// kit) did for scripts/check-parity.mts, whose option is `--extension`.
test('every option that a recipe passes to a script of scripts/ is declared by that script', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const found: string[] = [];
  let checked = 0;
  for (const [, script, rest] of makefile.matchAll(/\$\(NODE\) scripts\/([\w-]+\.mts)([^\n]*)/g)) {
    if (script === undefined || rest === undefined) throw new Error('the pattern of a script recipe matched without its groups');
    const source = readFileSync(path.join(ROOT, 'scripts', script), 'utf8');
    if (!source.includes('parseArgs(')) continue;
    const declared = new Set([...source.matchAll(/['"]?([a-z][\w-]*)['"]?:\s*\{\s*type:/g)].map((match) => match[1]));
    for (const [, option] of rest.matchAll(/(?:^|\s)--([\w-]+)/g)) {
      checked += 1;
      if (!declared.has(option)) found.push(`scripts/${script} does not declare --${option}; it declares ${[...declared].map((name) => `--${name}`).join(', ')}`);
    }
  }
  assert.ok(checked > 10, `only ${checked} options were checked`);
  assert.deepEqual(found, []);
});

// The targets of the kit that run npm in the consumer projects of tests/release-install need npm_config_allow_remote (H13.5-14):
// npm 12 refuses the template tarballs, which the lock pins by their integrity, under the default setting, so `npm ci` of
// release-consumer and release-proof runs with `root`; npm 12.2.0 also refuses to write the lock while it counts the registry
// tarball of a package with bundleDependencies as remote (npm/cli#9818), so release-consumer-lock runs with `all`.
test('every target that runs npm in the release consumer projects exports npm_config_allow_remote', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const expected = { 'release-consumer': 'root', 'release-proof': 'root', 'release-consumer-lock': 'all' };
  const actual = Object.fromEntries(Object.keys(expected).map((target) => [target, new RegExp(`^${target}: export npm_config_allow_remote := (\\w+)$`, 'm').exec(makefile)?.[1]]));
  assert.deepEqual(actual, expected);
});
