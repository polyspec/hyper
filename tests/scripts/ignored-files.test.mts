// Tests `.gitignore` (HR-88): it ignores no tracked file, and it ignores every output that the installs, the builds,
// the test runs and the guards write into the checkout, so that a run leaves the tracked tree unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// One path inside each output that an install, a build, a test run or a guard writes.
const OUTPUTS = [
  'node_modules/vitest/package.json',
  'vendor/autoload.php',
  'composer.local.lock',
  'examples/board/composer.local.lock',
  'examples/board/vendor/autoload.php',
  'tests/package-install/node_modules/@polyspec/hyper-client/package.json',
  'tests/package-install/var/link/npm/bin/template',
  'tests/package-install/var/link/npm/cache/_logs/install.log',
  'packages/client/dist/index.js',
  'packages/client/dist.next-12345/index.js',
  'packages/server/ts/dist/index.js',
  'packages/server/php/tests/build/server/php/GeneratedProgram.php',
  'packages/server/ts/tests/build/templates.index.json',
  'examples/board/build/server/php/GeneratedProgram.php',
  'examples/board/build/csr.next-12345/index.html',
  'examples/board/public/assets/hyper-ABC123.js',
  'examples/board/public/assets/hyper-ABC123.js.next-12345',
  'examples/board/public/assets/templates/layout.0123456789ab.json',
  'examples/board/var/board.db',
  'build/ext/polyspec_template.so',
  'build/ext/polyspec_template.so.inputs.json',
  'build/phpstan/cache.php',
  'var/products/template-ext/src/polyspec_template.stub.php',
  'var/products/template-ext.next-12345/src/config.m4',
  'var/tools/bin/npm',
  'var/install.lock',
  'tests/e2e/test-results/.last-run.json',
  'tests/scripts/build/virtiofs/file/layout.tpl',
  'packages/server/python/.venv/bin/python',
  'packages/server/python/src/polyspec_hyper_server.egg-info/PKG-INFO',
  'playwright-report/index.html',
  'packages/server/php/.phpunit.result.cache',
];

test('.gitignore ignores no tracked file', () => {
  const ignored = git('ls-files', '--cached', '--ignored', '--exclude-standard');
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.equal(ignored.stdout, '', `tracked files that .gitignore ignores:\n${ignored.stdout}`);
});

test('.gitignore ignores every output of the installs, the builds, the test runs and the guards', () => {
  // Git refuses paths below a directory symlink. Check that installed directory itself in a linked worktree.
  const outputs = OUTPUTS.map((file) => {
    const parts = file.split('/');
    for (let length = 1; length < parts.length; length++) {
      const prefix = parts.slice(0, length).join('/');
      if (lstatSync(path.join(ROOT, prefix), { throwIfNoEntry: false })?.isSymbolicLink()) return prefix;
    }
    return file;
  });
  const result = git('check-ignore', '--no-index', '--verbose', '--non-matching', ...outputs);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trimEnd().split('\n').length, outputs.length, result.stdout);
  const notIgnored = result.stdout.split('\n').filter((line) => line.startsWith('::')).map((line) => line.split('\t')[1]);
  assert.deepEqual(notIgnored, [], `outputs that .gitignore does not ignore: ${notIgnored.join(' ')}`);
});
