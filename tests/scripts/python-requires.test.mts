// The Python support range of the server package states what CI tests (H20.12): requires-python of
// packages/server/python/pyproject.toml is the minor release of the python of mise.toml and nothing older, because CI
// runs only that release (make install-tools installs the Python of mise.toml at the digest of mise.lock, kit K127).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');

test('requires-python of the Python server package is the minor release of the python of mise.toml (H20.12)', () => {
  const pyproject = readFileSync(join(repository, 'packages/server/python/pyproject.toml'), 'utf8');
  const declared = /^requires-python = "(>=\d+\.\d+)"$/m.exec(pyproject)?.[1];
  assert.ok(declared, 'pyproject.toml declares requires-python as ">=<major>.<minor>"');
  const release = /^python = "(\d+\.\d+)\.\d+"$/m.exec(readFileSync(join(repository, 'mise.toml'), 'utf8'))?.[1];
  assert.ok(release, 'mise.toml declares python as an exact release');
  assert.equal(declared, `>=${release}`, `requires-python ${declared} must state the tested minor release of the python of mise.toml (${release})`);
});
