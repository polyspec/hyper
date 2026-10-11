// The Python support range of the server package states what CI tests (H20.12): requires-python of
// packages/hyper-server-python/pyproject.toml is the minor release of .python-version and nothing older, because CI runs
// only that release (the matrix of .github/workflows/ci.yml runs make install-tools, which installs the pinned Python).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');

test('requires-python of the Python server package is the minor release of .python-version (H20.12)', () => {
  const pyproject = readFileSync(join(repository, 'packages/hyper-server-python/pyproject.toml'), 'utf8');
  const declared = /^requires-python = "(>=\d+\.\d+)"$/m.exec(pyproject)?.[1];
  assert.ok(declared, 'pyproject.toml declares requires-python as ">=<major>.<minor>"');
  const minor = readFileSync(join(repository, '.python-version'), 'utf8').trim();
  assert.match(minor, /^\d+\.\d+$/, '.python-version holds the minor release');
  assert.equal(declared, `>=${minor}`, `requires-python ${declared} must state the tested minor release of .python-version (${minor})`);
});
