// The PHP reader reads the functions that a file declares as members (HYR-8): a namespaced function is a function
// member of a functions unit whose symbol names the function, and an @internal function is internal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readTree } from '../../scripts/recipe/readers.mts';
import type { Sources } from '../../scripts/recipe/types.mts';
import { validators } from '../../scripts/recipe/validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe', 'readers', 'php-functions');

// The Sources document that the PHP reader prints for a copy of the fixture, checked against its schema. The reader
// lists the sources with git ls-files, so the copied fixture is a git tree of its own.
function readFixture(): Sources {
  const dir = mkdtempSync(path.join(tmpdir(), 'read-php-functions-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    for (const args of [['init', '-q'], ['add', '-A']]) {
      const git = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    return readTree(dir, 'php', ['src'], [], validators().sources, ['--autoload', path.join(dir, 'autoload.php')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a PHP function declared in a file is a function member of a functions unit (HYR-8)', () => {
  const out = readFixture();

  const members = out.members.map((m) => `${m.name}:${m.kind}`);
  const run = out.members.find((m) => m.name === 'run');
  assert.ok(run, `run is not a member; the members are ${members.join(', ') || 'none'}`);
  assert.equal(run.kind, 'function', `run is a ${run.kind} member`);
  assert.equal(run.unit, 'Tools', `run is a member of ${run.unit}`);
  assert.equal(run.visibility, 'public', `run is ${run.visibility}`);
  assert.equal(run.symbol, 'src/Tools.php::Fixture\\Tools\\run', `run has the symbol ${run.symbol}`);
  assert.equal(out.units.find((u) => u.name === 'Tools')?.kind, 'functions', 'Tools is not a functions unit');

  const helper = out.members.find((m) => m.name === 'helper');
  assert.equal(helper?.visibility, 'internal', `helper is ${helper?.visibility}, not internal`);
});

test('a method after a string interpolation of a class is no function of the file (HYR-8)', () => {
  const out = readFixture();
  const stray = out.members.filter((m) => m.file === 'src/Interpolated.php' && m.kind === 'function');
  assert.deepEqual(stray, [], `the methods of Interpolated are read as functions: ${stray.map((m) => m.name).join(', ')}`);
});

test('a function of a file that the autoloader does not load is read from its file (HYR-8)', () => {
  const out = readFixture();
  assert.ok(out.members.some((m) => m.file === 'src/Loose.php' && m.name === 'loose' && m.kind === 'function'), 'loose is not a function member of src/Loose.php');
});

test('a file with a class and a function is one unit of that name (HYR-3)', () => {
  const out = readFixture();
  const named = out.units.filter((u) => u.name === 'Blend');
  assert.equal(named.length, 1, `Blend is ${named.length} units: ${JSON.stringify(named)}`);
  assert.equal(out.members.find((m) => m.name === 'blend')?.unit, 'Blend', 'mixed is not a member of the Blend unit');
});

test('the host file Run.php declares the run function of the front controller and no class (HY-106.20)', () => {
  const app = path.join(repo, 'packages', 'php', 'src', 'Host', 'Run.php');
  const script = 'require $argv[1]; echo json_encode(declaredFunctions(file_get_contents($argv[2])));';
  const result = spawnSync(process.env.RECIPE_PHP ?? 'php', ['-r', script, path.join(repo, 'scripts', 'recipe', 'read-php-functions.php'), app], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['Polyspec\\Hyper\\run'], `Run.php declares ${result.stdout}`);
});

