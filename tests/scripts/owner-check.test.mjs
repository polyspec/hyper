// Tests the owner checks of changed paths (scripts/owner-check.mjs and scripts/owner-checks.json, HY-88): a path
// selects exactly the targets that the declaration names for it, a tracked path without an owner and a glob without a
// path fail with their names, a rule with a variable passes its paths to its target, and the declaration of this
// repository owns every tracked path. The fixture cases run a copy of the script in a temporary Git repository whose
// Makefile targets only print their names; the test files run through the target test-scripts with TESTS.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/owner-check.mjs';

const MAKEFILE = `CHECK_TARGETS := docs-check docs-static-check conformance-cases unit
docs-check:
\t@echo "ran docs-check"
docs-static-check:
\t@echo "ran docs-static-check"
conformance-cases:
\t@echo "ran conformance-cases CASES=$(CASES)"
unit:
\t@echo "ran unit"
test-scripts:
\t@echo "ran test-scripts TESTS=$(TESTS)"
check:
\t@echo "ran the full suite"
release-test-matrix:
\tnode scripts/full-run.mjs run $(CHECK_TARGETS)
`;

const OWNERS = {
  owners: [
    { paths: ['docs/**', '*.md'], targets: ['docs-check', 'docs-static-check'] },
    { paths: ['tests/cases/**'], targets: ['conformance-cases'], variable: 'CASES' },
    { paths: ['src/**', 'Makefile', 'scripts/**'], targets: ['unit'] },
  ],
};

function git(directory, ...args) {
  const run = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
}

// A committed repository with the script, the Makefile, the declaration `owners` and the files `files`.
function repository(t, owners, files) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-owner-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'scripts'));
  copyFileSync(path.join(ROOT, SCRIPT), path.join(directory, SCRIPT));
  writeFileSync(path.join(directory, 'Makefile'), MAKEFILE);
  writeFileSync(path.join(directory, 'scripts/owner-checks.json'), JSON.stringify(owners));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), text);
  }
  git(directory, 'init', '--quiet');
  git(directory, 'add', '.');
  git(directory, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'fixture');
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: directory, encoding: 'utf8' });
  run.directory = directory;
  return run;
}

const FILES = { 'README.md': '# Fixture\n', 'docs/index.md': '# Index\n', 'src/main.txt': 'main\n', 'tests/cases/text/plain/input.tpl': 'a\n' };

test('a docs path runs exactly docs-check and docs-static-check', (t) => {
  const run = repository(t, OWNERS, FILES)('--paths', 'docs/index.md');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^\[owner-check\] docs\/index\.md -> docs-check docs-static-check$/m);
  assert.deepEqual(run.stdout.match(/^ran .*$/gm), ['ran docs-check', 'ran docs-static-check']);
});

test('a tracked path without an owner fails with its name before any target runs', (t) => {
  const owners = { owners: OWNERS.owners.filter(rule => !rule.paths.includes('src/**')).concat([{ paths: ['Makefile', 'scripts/**'], targets: ['unit'] }]) };
  const run = repository(t, owners, FILES)('--paths', 'docs/index.md');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /^\[owner-check\] src\/main\.txt: the path matches no owner in scripts\/owner-checks\.json$/m);
  assert.equal(run.stdout.match(/^ran /m), null, run.stdout);
});

test('a new path without an owner fails with its name', (t) => {
  const check = repository(t, OWNERS, FILES);
  mkdirSync(path.join(check.directory, 'notes'));
  writeFileSync(path.join(check.directory, 'notes/new.txt'), 'new\n');
  const run = check();
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /^\[owner-check\] notes\/new\.txt: the path matches no owner in scripts\/owner-checks\.json$/m);
});

test('a removed path that no rule owns selects nothing', (t) => {
  const run = repository(t, OWNERS, FILES)('--paths', 'notes/removed.txt docs/index.md');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^\[owner-check\] notes\/removed\.txt -> nothing: the path was removed and no rule owns it$/m);
  assert.deepEqual(run.stdout.match(/^ran .*$/gm), ['ran docs-check', 'ran docs-static-check']);
});

test('a removed test file is not run', (t) => {
  const owners = { owners: [...OWNERS.owners, { paths: ['tests/*.test.mjs'], tests: ['$path'] }] };
  const run = repository(t, owners, { ...FILES, 'tests/kept.test.mjs': '' })('--dry-run', '--paths', 'tests/removed.test.mjs');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^\[owner-check\] tests\/removed\.test\.mjs -> $/m);
  assert.match(run.stdout, /^\[owner-check\] 1 changed paths select nothing$/m);
});

test('a glob that matches no path and a full-suite target fail with their names', (t) => {
  const owners = { owners: [...OWNERS.owners, { paths: ['schema/**'], targets: ['check'] }] };
  const run = repository(t, owners, FILES)('--validate');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /the glob schema\/\*\* matches no tracked path/);
  assert.match(run.stderr, /the target check runs the full suite/);
});

test('a target that runs the guard of the full suite is a full-suite target', (t) => {
  const owners = { owners: [...OWNERS.owners, { paths: ['docs/**'], targets: ['release-test-matrix'] }] };
  const run = repository(t, owners, FILES)('--validate');
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /the target release-test-matrix runs the full suite/);
});

test('a test file runs through test-scripts with TESTS', (t) => {
  const owners = { owners: [...OWNERS.owners, { paths: ['tests/*.test.mjs'], tests: ['$path'] }] };
  const run = repository(t, owners, { ...FILES, 'tests/one.test.mjs': '' })('--paths', 'tests/one.test.mjs');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(run.stdout.match(/^ran .*$/gm), ['ran test-scripts TESTS=tests/one.test.mjs']);
});

test('a rule with a variable passes its changed paths to its target', (t) => {
  const run = repository(t, OWNERS, FILES)('--paths', 'tests/cases/text/plain/input.tpl tests/cases/text/other/input.tpl');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^ran conformance-cases CASES=tests\/cases\/text\/plain\/input\.tpl tests\/cases\/text\/other\/input\.tpl$/m);
});

test('the declaration of this repository owns every path and selects the owners of a document and of a script', () => {
  const validate = spawnSync(process.execPath, [SCRIPT, '--validate'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const document = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--paths', 'docs/features.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(document.status, 0, document.stdout + document.stderr);
  assert.match(document.stdout, /^\[owner-check\] 1 changed paths select docs-check$/m);
  // A script that no test named before HY-88 selects its owners.
  const script = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--paths', 'scripts/copy-package.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(script.status, 0, script.stdout + script.stderr);
  assert.match(script.stdout, /^\[owner-check\] 1 changed paths select template-check; test-scripts TESTS=tests\/scripts\/build-assets\.test\.mjs tests\/scripts\/publish\.test\.mjs tests\/scripts\/template-copy\.test\.mjs$/m);
});
