// Tests `.gitignore` (HY-88): it ignores no tracked file, and it ignores every output that the installs, the builds,
// the test runs and the guards write into the checkout, so that a run leaves the tracked tree unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// One path inside each output that an install, a build, a test run or a guard writes.
const OUTPUTS = [
  'node_modules/vitest/package.json',
  'packages/hyper-php/vendor/autoload.php',
  'examples/board/vendor/autoload.php',
  'tests/package-install/node_modules/@polyspec/hyper/package.json',
  'packages/hyper-js/dist/index.js',
  'packages/hyper-js/dist.next-12345/index.js',
  'packages/hyper-node/dist/index.js',
  'packages/hyper-php/tests/build/server/program.php',
  'packages/hyper-node/tests/build/templates.index.json',
  'examples/board/build/server/program.php',
  'examples/board/build/csr.next-12345/index.html',
  'examples/board/public/assets/hyper-ABC123.js',
  'examples/board/public/assets/hyper-ABC123.js.next-12345',
  'examples/board/public/assets/templates/layout.0123456789ab.json',
  'examples/board/var/board.db',
  'build/ext/polyspec_template.so',
  'build/ext/polyspec_template.so.inputs.json',
  'build/phpstan/cache.php',
  'var/products/template/copy.json',
  'var/products/template.next-12345/copy.json',
  'var/tools/bin/npm',
  'var/full-run.json',
  'var/full-run.lock',
  'var/install.lock',
  'test-results/.last-run.json',
  'playwright-report/index.html',
  'packages/hyper-php/.phpunit.result.cache',
];

test('.gitignore ignores no tracked file', () => {
  const ignored = git('ls-files', '--cached', '--ignored', '--exclude-standard');
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.equal(ignored.stdout, '', `tracked files that .gitignore ignores:\n${ignored.stdout}`);
});

test('.gitignore ignores every output of the installs, the builds, the test runs and the guards', () => {
  const result = git('check-ignore', '--no-index', '--verbose', '--non-matching', ...OUTPUTS);
  const notIgnored = result.stdout.split('\n').filter((line) => line.startsWith('::')).map((line) => line.split('\t')[1]);
  assert.deepEqual(notIgnored, [], `outputs that .gitignore does not ignore: ${notIgnored.join(' ')}`);
});
