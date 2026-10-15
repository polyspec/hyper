// Tests that the build package @polyspec/hyper-build holds everything that its bins run (HY-96): its modules import
// only their own published files, built-in modules of Node and the packages that its manifest requires, so the
// package that a consumer installs runs as the repository runs it; and the builds run from any working directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { jsonArray, jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
const build = join(repository, 'packages', 'build');

// The module specifiers of a source: static imports and exports, dynamic imports and URLs relative to the module.
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s+'([^']+)'/g, /\bimport\s+'([^']+)'/g, /\bimport\(\s*'([^']+)'/g, /new URL\(\s*'([^']+)'/g]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) throw new Error(`${pattern} matched ${match[0]} without its specifier`);
      found.push(specifier);
    }
  }
  return found;
}

test('the modules of the build package import only its published files, Node and its dependencies', () => {
  const manifestFile = join(build, 'package.json');
  const manifest = parseJsonObject(readFileSync(manifestFile, 'utf8'), manifestFile);
  const dependencies = Object.keys(jsonObject(manifest.dependencies, `${manifestFile} dependencies`));
  const folders = jsonArray(manifest.files, `${manifestFile} files`).map((folder, index) => jsonString(folder, `${manifestFile} files[${index}]`));
  const modules = folders.flatMap((folder) => readdirSync(join(build, folder), { recursive: true, encoding: 'utf8' }).map((file) => join(build, folder, file)))
    .filter((file) => file.endsWith('.mjs'));
  assert.ok(modules.length >= 6, `expected at least 6 modules, actual ${modules.length}`);
  for (const module of modules) {
    for (const specifier of specifiers(readFileSync(module, 'utf8'))) {
      const name = relative(repository, module);
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        const target = relative(build, resolve(module, '..', specifier));
        const top = target.split(sep)[0];
        assert.ok(top !== undefined && !target.startsWith('..') && folders.includes(top), `${name} imports ${specifier} outside the published files`);
        continue;
      }
      const packageName = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
      assert.ok(dependencies.includes(packageName), `${name} imports ${specifier}, which the manifest does not require`);
    }
  }
});

test('builds the templates and the server program from another working directory', () => {
  requireBuilt('packages', 'node_modules/@polyspec/hyper-client/dist/index.js', 'node_modules/@polyspec/hyper-client/data-template.json');
  const output = mkdtempSync(join(tmpdir(), 'hyper-scripts-'));
  try {
    const board = join(repository, 'examples', 'board');
    const templates = spawnSync(process.execPath, [join(repository, 'scripts', 'build-templates.mts'), '--templates', join(board, 'templates'), '--output', join(output, 'templates')], { cwd: output, encoding: 'utf8' });
    assert.equal(templates.status, 0, templates.stderr);
    const server = spawnSync(process.execPath, [
      join(build, 'bin', 'hyper-build-server.mjs'), '--manifest', join(board, 'app', 'app.json'), '--templates', join(board, 'templates'),
      '--output', join(output, 'server'), '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
    ], { cwd: output, encoding: 'utf8' });
    assert.equal(server.status, 0, server.stderr);
    // HY-48: the generated program is the PSR-4 files of the namespace in the directory php, which the autoload of
    // Composer loads, and program.json names the namespace.
    const php = readdirSync(join(output, 'server', 'php')).sort();
    assert.ok(php.includes('GeneratedProgram.php') && php.includes('GeneratedTemplates.php'), `server/php holds ${php.join(', ')}`);
    assert.ok(php.every((file) => file.endsWith('.php')), `server/php holds ${php.join(', ')}`);
    assert.ok(!existsSync(join(output, 'server', 'program.php')), 'the build writes program.php');
    const declaration = parseJsonObject(readFileSync(join(output, 'server', 'program.json'), 'utf8'), 'server/program.json');
    assert.equal(declaration.namespace, 'Polyspec\\Hyper\\Examples\\Board\\Program');
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
