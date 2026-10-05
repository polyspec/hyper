// Tests that npm and Composer installed every dependency of this checkout as a copy (HY-79): no directory node_modules
// or vendor of the checkout holds a symbolic link, neither a package nor a bin link. Run it after `make install`.
import assert from 'node:assert/strict';
import { readdirSync, readlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');

// Returns every symbolic link below `directory`, with its target.
function links(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) found.push(`${relative(repository, path)} -> ${readlinkSync(path)}`);
    else if (entry.isDirectory()) found.push(...links(path));
  }
  return found;
}

// Returns every directory node_modules or vendor of the checkout outside .git, without the ones inside another.
function installDirectories(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'vendor') found.push(path);
    else found.push(...installDirectories(path));
  }
  return found;
}

test('no directory node_modules or vendor holds a symbolic link', () => {
  const directories = installDirectories(repository);
  assert.ok(directories.some((path) => path === join(repository, 'node_modules')), 'node_modules is missing; run make install');
  assert.deepEqual(directories.flatMap(links), []);
});
