// Tests that Composer installed every dependency of this checkout as a copy (HY-79): no directory vendor of the checkout
// holds a symbolic link. npm installs with its own defaults, so node_modules holds the links of its workspaces and bins,
// which npm creates. Run it after `make install`.
import assert from 'node:assert/strict';
import { readdirSync, readlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mjs';

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

// Returns every directory vendor of the checkout outside .git and node_modules, without the ones inside another.
function installDirectories(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.name === 'vendor') found.push(path);
    else found.push(...installDirectories(path));
  }
  return found;
}

test('no directory vendor holds a symbolic link', () => {
  requireBuilt('install', 'vendor', 'examples/board/vendor');
  const directories = installDirectories(repository);
  assert.deepEqual(directories.flatMap(links), []);
});
