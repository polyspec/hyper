// Tests that the build package @polyspec/hyper-build holds everything that its bins run (HY-96): its modules import
// only their own published files, built-in modules of Node and the packages that its manifest requires, so the
// package that a consumer installs runs as the repository runs it; and the builds run from any working directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mjs';

const repository = resolve('.');
const build = join(repository, 'packages', 'hyper-build');

// The module specifiers of a source: static imports and exports, dynamic imports and URLs relative to the module.
function specifiers(source) {
  const found = [];
  for (const pattern of [/\bfrom\s+'([^']+)'/g, /\bimport\s+'([^']+)'/g, /\bimport\(\s*'([^']+)'/g, /new URL\(\s*'([^']+)'/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

test('the modules of the build package import only its published files, Node and its dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8'));
  const dependencies = Object.keys(manifest.dependencies);
  const modules = manifest.files.flatMap((folder) => readdirSync(join(build, folder), { recursive: true }).map((file) => join(build, folder, file)))
    .filter((file) => file.endsWith('.mjs'));
  assert.ok(modules.length >= 6, `expected at least 6 modules, actual ${modules.length}`);
  for (const module of modules) {
    for (const specifier of specifiers(readFileSync(module, 'utf8'))) {
      const name = relative(repository, module);
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        const target = relative(build, resolve(module, '..', specifier));
        assert.ok(!target.startsWith('..') && manifest.files.includes(target.split(sep)[0]), `${name} imports ${specifier} outside the published files`);
        continue;
      }
      const packageName = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
      assert.ok(dependencies.includes(packageName), `${name} imports ${specifier}, which the manifest does not require`);
    }
  }
});

test('builds the templates and the server program from another working directory', () => {
  requireBuilt('packages', 'node_modules/@polyspec/hyper/dist/index.js', 'node_modules/@polyspec/hyper/data-template.json');
  const output = mkdtempSync(join(tmpdir(), 'hyper-scripts-'));
  try {
    const board = join(repository, 'examples', 'board');
    const templates = spawnSync(process.execPath, [join(repository, 'scripts', 'build-templates.mjs'), '--templates', join(board, 'templates'), '--output', join(output, 'templates')], { cwd: output, encoding: 'utf8' });
    assert.equal(templates.status, 0, templates.stderr);
    const server = spawnSync(process.execPath, [
      join(build, 'bin', 'hyper-build-server.mjs'), '--manifest', join(board, 'app', 'app.json'), '--templates', join(board, 'templates'),
      '--output', join(output, 'server'), '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
    ], { cwd: output, encoding: 'utf8' });
    assert.equal(server.status, 0, server.stderr);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
