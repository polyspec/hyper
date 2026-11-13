// Tests that the command tool @polyspec/hyper-cli holds everything that its bin runs (HR-96): its modules import
// only their own published files, built-in modules of Node and the packages that its manifest requires, so the
// package that a consumer installs runs as the repository runs it; and hyper build runs from any working directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { jsonArray, jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { copyTracked } from '../../scripts/tracked-files.mts';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
const build = join(repository, 'packages', 'cli');

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

test('the modules of the command tool import only its published files, Node and its dependencies', () => {
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

test('hyper build builds the browser outputs and the server program from another working directory', (t) => {
  requireBuilt('packages', 'node_modules/@polyspec/hyper-client/dist/index.js', 'node_modules/@polyspec/hyper-client/data-template.json');
  const directory = mkdtempSync(join(tmpdir(), 'hyper-scripts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = join(directory, 'app');
  copyTracked({ repository, path: 'tests/scripts/fixtures/chunks', target: app, base: 'tests/scripts/fixtures/chunks' });
  const cwd = join(directory, 'elsewhere');
  mkdirSync(cwd);
  const result = spawnSync(process.execPath, [
    join(build, 'bin', 'hyper.mjs'), 'build', '--app', app, '--output', join(app, 'out'), '--api', '/api',
    '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
  ], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  // HY-48: the generated program is the PSR-4 files of the namespace in the directory php, which the autoload of
  // Composer loads, and program.json names the namespace.
  const program = join(app, 'out', 'program');
  const php = readdirSync(join(program, 'php')).sort();
  assert.ok(php.includes('GeneratedProgram.php') && php.includes('GeneratedTemplates.php'), `program/php holds ${php.join(', ')}`);
  assert.ok(php.every((file) => file.endsWith('.php')), `program/php holds ${php.join(', ')}`);
  assert.ok(!existsSync(join(program, 'program.php')), 'the build writes program.php');
  const declaration = parseJsonObject(readFileSync(join(program, 'program.json'), 'utf8'), 'program/program.json');
  assert.equal(declaration.namespace, 'Polyspec\\Hyper\\Examples\\Board\\Program');
  assert.ok(existsSync(join(app, 'out', 'client', 'csr', 'index.html')));
  assert.deepEqual(readdirSync(cwd), []);
});
