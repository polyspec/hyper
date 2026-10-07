// Tests that a recipe with several checks runs every check to its end and then fails, naming each failed check
// (HY-86): `make lint` and `make test-js` run on directories whose checks all fail, and the dry runs of the other
// recipes with several checks show one accumulating command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';
import { requireBuilt } from './requires.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-check-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Runs `make <target> <variables>` in the checkout without the variables of a calling make.
function make(target, variables) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name)));
  return spawnSync('make', ['--no-print-directory', target, ...variables], { cwd: ROOT, env, encoding: 'utf8' });
}

test('make lint runs both formatting checks when the first fails and names both', (t) => {
  const directory = temporary(t);
  const projects = ['package', 'board'].map((name) => {
    const project = path.join(directory, name);
    mkdirSync(path.join(project, 'vendor', 'bin'), { recursive: true });
    // The stub prints without a final newline, as Pint does.
    writeFileSync(path.join(project, 'vendor', 'bin', 'pint'), `#!/bin/sh\ntouch ${path.join(directory, `${name}.ran`)}\nprintf '${name} is not formatted'\nexit 1\n`);
    chmodSync(path.join(project, 'vendor', 'bin', 'pint'), 0o755);
    return project;
  });
  const run = make('lint', [`PHP_PACKAGE=${projects[0]}`, `PHP_VENDOR=${path.join(projects[0], 'vendor')}`, `BOARD=${projects[1]}`]);
  assert.notEqual(run.status, 0);
  assert.ok(existsSync(path.join(directory, 'package.ran')) && existsSync(path.join(directory, 'board.ran')), run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`failed checks: Pint of ${projects[0]}; Pint of ${projects[1]};`));
  // Every line of the recipe starts at column 0, after output without a final newline too (HY-84).
  const lines = run.stdout.split('\n');
  assert.ok(lines.includes('package is not formatted'), run.stdout);
  assert.ok(lines.includes(`cd ${projects[1]} && vendor/bin/pint --test app src public`), run.stdout);
  assert.ok(lines.includes('board is not formatted'), run.stdout);
  assert.ok(lines.some((line) => line.startsWith('failed checks:')), run.stdout);
});

test('make test-js runs the type check when the tests fail and names both', (t) => {
  requireBuilt('install', 'node_modules/@polyspec/template/package.json');
  const directory = temporary(t);
  writeFileSync(path.join(directory, 'fails.test.mjs'), "import { test, expect } from 'vitest';\ntest('fails', () => expect(1).toBe(2));\n");
  writeFileSync(path.join(directory, 'wrong.ts'), "export const value: number = 'text';\n");
  writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ['wrong.ts'] }));
  const run = make('test-js', [`JS_PACKAGE=${directory}`]);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /✖ vitest: 0 passed, 1 failed/);
  assert.match(`${run.stdout}${run.stderr}`, /wrong\.ts\(1,14\): error TS2322/);
  assert.match(run.stdout, new RegExp(`failed checks: the tests of ${directory}; the type check of ${directory};`));
});

test('every other recipe with several checks runs them in one accumulating command', () => {
  for (const [target, checks] of [['test-node', 2], ['test-php', 2], ['parity', 2], ['bench-server', 2]]) {
    const lines = dryRun(target, { variables: ['TEMPLATE_DIR=var/products/template'] });
    const start = lines.findLastIndex((line) => line === 'failed=; \\');
    assert.ok(start >= 0, `${target}:\n${lines.join('\n')}`);
    const recipe = lines.slice(start);
    assert.equal(recipe.filter((line) => line.includes("node scripts/line-end.mjs '") && line.includes(' || failed="$failed ')).length, checks, `${target}:\n${recipe.join('\n')}`);
    assert.match(recipe.at(-1), /test -z "\$failed" \|\| \{ echo "failed checks:\$failed"; exit 1; \}/, target);
  }
});
