// Tests scripts/fixture-program.mts (HY-125.21): a test program with a fixed build id comes from the assembly of
// `hyper build` with that id as its argument, and the command tool itself takes no build id.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { shellText } from '../../packages/cli/lib/shell.mjs';
import { requireBuilt } from './requires.mts';

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
  assert.deepEqual(readdirSync(output).sort(), ['build.json', 'php', 'program.json', 'reads.json', 'templates']);
  assert.ok(existsSync(join(output, 'php', 'GeneratedProgram.php')));
});

test('the program names the literal key of an index in reads.json by its text (HY-73.33)', (t) => {
  requireBuilt('packages node-addon', 'packages/ts/dist/build.js', `packages/ts/native/generated/hyper.${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}.node`);
  const directory = mkdtempSync(join(tmpdir(), 'hyper-fixture-program-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const templates = join(directory, 'templates');
  mkdirSync(templates);
  writeFileSync(join(templates, 'layout.tpl'), '<head><title>{# title}</title>{# build}</head>\n<main id="content">{# content}</main>\n{# data}\n');
  writeFileSync(join(templates, 'title.tpl'), '{= title}');
  writeFileSync(join(templates, 'page.tpl'), '{= a["k"]}{= a[2]}{= a[1e21]}');
  const manifest = join(directory, 'app.json');
  writeFileSync(manifest, JSON.stringify({ layout: 'layout.tpl', title: 'title.tpl', regions: [{ name: 'content', page: true }], routes: [{ name: 'home', path: '/', title: 'Home', template: 'page.tpl' }] }));
  const output = join(directory, 'program');
  const result = spawnSync(process.execPath, [
    'scripts/fixture-program.mts', '--manifest', manifest, '--templates', templates, '--output', output,
    '--php-namespace', 'Polyspec\\Hyper\\Tests\\Program', '--id-file', join(fixtures, 'build.json'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  // HY-73.32: the keys follow the byte order of their text.
  const keys = '"a":{"keys":{"1e+21":true,"2":true,"k":true}}';
  assert.equal(readFileSync(join(output, 'reads.json'), 'utf8'), `{"routes":{"home":{"shared":{"keys":{${keys},"title":true}},"regions":{"content":{"keys":{${keys}}}}}}}\n`);
});

test('a build file without a build id of 64 lowercase hexadecimal characters fails and writes nothing (HY-125.19)', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-fixture-program-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const idFile = join(directory, 'build.json');
  writeFileSync(idFile, '{"build":"ABC"}');
  const output = join(directory, 'program');
  const result = program(output, idFile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the build id ABC is not 64 lowercase hexadecimal characters/);
  assert.equal(existsSync(output), false);
});

test('the shell of a test takes its build id as an argument (HY-125.21)', () => {
  const shell = shellText({ api: '/api', build: '1'.repeat(64), entry: { url: '/assets/hyper-A.js', code: 'export{};' } });
  assert.ok(shell.includes(`<meta name="hyper-build" content="${'1'.repeat(64)}">`), shell);
  assert.ok(shell.includes('<meta name="hyper-entry" content="/assets/hyper-A.js">'), shell);
  assert.throws(() => shellText({ api: '/api', build: '1'.repeat(64), entry: { url: '/assets/hyper-A.js', code: '</script>' } }), /cannot be inlined/);
});
