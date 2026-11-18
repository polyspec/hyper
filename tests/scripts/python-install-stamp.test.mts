// Tests that make hyper-test-python tests no installed Python package older than the tree (HR-85, H34.17): the venv
// holds polyspec-hyper non-editable (kit K788), so make hyper-install-python writes the digest of the sources that it
// built into the venv, and hyper-test-python fails, naming make hyper-install-python, when that digest is missing or is
// not the digest of the sources of the tree.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('hyper-install-python writes the digest of its sources and hyper-test-python checks it first (H34.17)', () => {
  const install = dryRun('hyper-install-python');
  assert.ok(install.some((line) => /\/scripts\/python-install-stamp\.mts write /u.test(line)), `make -n hyper-install-python writes no digest of its sources:\n${install.join('\n')}`);
  const run = dryRun('hyper-test-python');
  const check = run.findIndex((line) => /\/scripts\/python-install-stamp\.mts check /u.test(line));
  const tests = run.findIndex((line) => /\/run-tests\.m[jt]s python /u.test(line));
  assert.ok(check >= 0 && tests >= 0 && check < tests, `make -n hyper-test-python runs the Python tests without checking the installed package first:\n${run.join('\n')}`);
});

test('the check passes for the digest of the tree and names make hyper-install-python otherwise (H34.17)', async (t) => {
  const { stampProblem, writeStamp } = await import('../../scripts/python-install-stamp.mts');
  const venv = mkdtempSync(path.join(tmpdir(), 'hyper-python-stamp-'));
  t.after(() => rmSync(venv, { recursive: true, force: true }));
  const missing = stampProblem(venv, ROOT);
  assert.match(missing ?? '', /make hyper-install-python/u, 'a venv without a digest passes the check');
  writeStamp(venv, ROOT);
  assert.equal(stampProblem(venv, ROOT), undefined, 'the digest that the install wrote fails the check');
  writeFileSync(path.join(venv, 'hyper-sources.sha256'), `${'0'.repeat(64)}\n`);
  assert.match(stampProblem(venv, ROOT) ?? '', /older than the sources.*make hyper-install-python/su, 'a digest of other sources passes the check');
});
