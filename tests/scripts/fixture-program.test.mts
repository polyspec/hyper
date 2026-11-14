// Tests scripts/fixture-program.mts (HY-125.21): a test program with a fixed build id comes from the assembly of
// `hyper build` with that id as its argument, and the command tool itself takes no build id.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { shellText } from '../../packages/cli/lib/shell.mjs';
import { requireNodeAddon } from './requires.mts';

// The command tool takes its rules from the Node binding of the core (HR-96).
requireNodeAddon();

const fixtures = resolve('packages/php/tests/fixtures');

function program(output: string, idFile: string) {
  return spawnSync(process.execPath, [
    'scripts/fixture-program.mts', '--manifest', join(fixtures, 'app.json'), '--templates', join(fixtures, 'templates'),
    '--output', output, '--php-namespace', 'Polyspec\\Hyper\\Tests\\Program', '--id-file', idFile,
  ], { encoding: 'utf8' });
}

test('writes the program of the fixture with the build id of its build file (HY-125.21)', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-fixture-program-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'program');
  const result = program(output, join(fixtures, 'build.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(output, 'build.json'), 'utf8'), readFileSync(join(fixtures, 'build.json'), 'utf8'));
  assert.deepEqual(readdirSync(output).sort(), ['build.json', 'legacy', 'php', 'program.json', 'reads.json', 'templates']);
  assert.ok(existsSync(join(output, 'php', 'GeneratedProgram.php')));
});

test('a build file without a build id of 64 lowercase hexadecimal characters fails and writes nothing (HY-125.19)', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-fixture-program-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const idFile = join(directory, 'build.json');
  writeFileSync(idFile, '{"build":"ABC"}');
  const output = join(directory, 'program');
  const result = program(output, idFile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /a build id is not 64 lowercase hexadecimal characters \(HY-125\.19\)/);
  assert.equal(existsSync(output), false);
});

test('the shell of a test takes its build id as an argument (HY-125.21)', () => {
  const shell = shellText({ api: '/api', build: '1'.repeat(64), entry: { url: '/assets/hyper-A.js', code: 'export{};' } });
  assert.ok(shell.includes(`<meta name="hyper-build" content="${'1'.repeat(64)}">`), shell);
  assert.ok(shell.includes('<meta name="hyper-entry" content="/assets/hyper-A.js">'), shell);
  assert.throws(() => shellText({ api: '/api', build: '1'.repeat(64), entry: { url: '/assets/hyper-A.js', code: '</script>' } }), /cannot be inlined/);
});
