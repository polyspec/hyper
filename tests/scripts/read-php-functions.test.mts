// The PHP reader reads the functions that a file declares as members (HYR-8): a namespaced function is a function
// member of a functions unit whose symbol names the function, and an @internal function is internal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const reader = path.join(repo, 'scripts', 'recipe', 'read-php.php');
const fixture = path.join(here, 'fixtures', 'recipe', 'readers', 'php-functions');

test('a PHP function declared in a file is a function member of a functions unit (HYR-8)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'read-php-functions-'));
  try {
    // The reader lists the sources with git ls-files, so the copied fixture is a git tree of its own.
    cpSync(fixture, dir, { recursive: true });
    for (const args of [['init', '-q'], ['add', '-A']]) {
      const git = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    const bin = process.env.RECIPE_PHP ?? 'php';
    const result = spawnSync(bin, [reader, dir, '--autoload', path.join(dir, 'autoload.php'), '--sources', 'src'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);

    const members = out.members.map((m: { name: string; kind: string }) => `${m.name}:${m.kind}`);
    const run = out.members.find((m: { name: string }) => m.name === 'run');
    assert.ok(run, `run is not a member; the members are ${members.join(', ') || 'none'}`);
    assert.equal(run.kind, 'function', `run is a ${run.kind} member`);
    assert.equal(run.unit, 'Tools', `run is a member of ${run.unit}`);
    assert.equal(run.visibility, 'public', `run is ${run.visibility}`);
    assert.equal(run.symbol, 'src/Tools.php::Fixture\\Tools\\run', `run has the symbol ${run.symbol}`);
    assert.equal(out.units.find((u: { name: string }) => u.name === 'Tools')?.kind, 'functions', 'Tools is not a functions unit');

    const helper = out.members.find((m: { name: string }) => m.name === 'helper');
    assert.equal(helper?.visibility, 'internal', `helper is ${helper?.visibility}, not internal`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a method after a string interpolation of a class is no function of the file (HYR-8)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'read-php-functions-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    for (const args of [['init', '-q'], ['add', '-A']]) {
      const git = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    const bin = process.env.RECIPE_PHP ?? 'php';
    const result = spawnSync(bin, [reader, dir, '--autoload', path.join(dir, 'autoload.php'), '--sources', 'src'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    const stray = out.members.filter((m: { file: string; name: string }) => m.file === 'src/Interpolated.php' && m.kind === 'function');
    assert.deepEqual(stray, [], `the methods of Interpolated are read as functions: ${stray.map((m: { name: string }) => m.name).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
