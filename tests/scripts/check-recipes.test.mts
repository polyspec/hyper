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
import { kitTool } from './kit-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('server build uses installed packages without Composer install (HR-79)', () => {
  const build = dryRun('server').join('\n');
  assert.match(build, /hyper-build-server\.mjs --manifest/);
  assert.doesNotMatch(build, /\bcomposer install\b/);
  assert.doesNotMatch(build, /composer-install\.(?:mts|mjs)/);
  const install = dryRun('hyper-server-php-install').join('\n');
  assert.match(install, /\bcomposer install\b/);
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


for (const target of ['lint-ts', 'parity-declarations-check']) {
  test(`H27.19 ${target} builds its workspace declarations before reading them`, () => {
    const steps = dryRun(target);
    const checker = steps.findIndex(step => step.includes(kitTool(target === 'lint-ts' ? 'lint-ts' : 'parity')));
    assert.ok(checker >= 0, `${target}: no native checker was selected`);
    for (const folder of ['packages/client', 'packages/server/ts']) {
      const build = steps.findIndex(step => step.includes(`cd ${folder} &&`) && step.includes('build'));
      assert.ok(build >= 0 && build < checker, `${target}: ${folder} declarations are not built before the check`);
    }
  });
}

test('H27.19 parity-check declares both runtime fixture producers without running a CI-only goal locally', () => {
  const database = dryRun('parity-declarations-check', { variables: ['-p'] });
  const prerequisites = database.find(line => line.startsWith('parity-check:'));
  assert.ok(prerequisites, 'the native Make database has no parity-check target');
  for (const target of ['server-fixtures', 'node-fixtures']) {
    assert.ok(prerequisites.split(/\s+/).includes(target), `parity-check does not declare ${target}`);
    const steps = dryRun(target);
    assert.ok(steps.some(step => step.includes('cd packages/server/ts &&') && step.includes('build')), `${target} does not build workspace declarations`);
  }
});


test('H27.21 script checks build their asset and server inputs before the runner', () => {
  const steps = dryRun('hyper-test-scripts');
  const runner = steps.findIndex(step => step.includes(kitTool('run-tests')));
  for (const producer of ['hyper-build-assets.mjs', 'hyper-build-server.mjs']) {
    const built = steps.findIndex(step => step.includes(producer));
    assert.ok(built >= 0 && built < runner, `${producer} is not built before script checks`);
  }
});

test('H27.21 package consumers use their native locked graph without editor-hook setup', () => {
  const steps = dryRun('package-check');
  assert.ok(steps.some(step => step.includes(kitTool('npm-install')) && step.includes('tests/package-install')));
  assert.ok(steps.some(step => step.includes('package-install.test.ts')));
  assert.deepEqual(steps.filter(step => step.includes(kitTool('link')) && step.includes('--project tests/package-install')), []);
});


test('H27.26 every Python checking target delegates discovery and execution to Kit (HR-84, HR-87)', () => {
  for (const target of ['hyper-test-python', 'hyper-test-python-render', 'python-file-parts-test']) {
    const lines = dryRun(target);
    const python = lines.filter(line => line.includes(`${kitTool('run-tests')} python`));
    assert.ok(python.length > 0, `${target}: shared Python runner is missing`);
    for (const line of python) assert.ok(line.includes('--venv ') && (line.includes(' discover ') || line.includes(' -- tests.')), line);
    assert.doesNotMatch(lines.join('\n'), /tests\/run\.py|python -m unittest/);
  }
  assert.equal(existsSync(path.join(ROOT, 'packages/server/python/tests/run.py')), false, 'a private Python runner must not remain');
});
