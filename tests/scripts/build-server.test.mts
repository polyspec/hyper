// Tests the option --build of hyper-build-server (HY-125): the build.json of the asset output is written into the
// program directory with the same bytes, and a missing option, a relative path, a missing file or a file that does not
// hold a build id of 64 lowercase hexadecimal characters fails with the path before any output is written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const fixtures = resolve('packages/server/php/tests/fixtures');
const id = '1111111111111111111111111111111111111111111111111111111111111111';

function server(output: string, ...options: string[]) {
  return spawnSync(process.execPath, [
    'packages/build/bin/hyper-build-server.mjs', '--manifest', join(fixtures, 'app.json'), '--templates', join(fixtures, 'templates'),
    '--output', output, '--php-namespace', 'Polyspec\\Hyper\\Server\\Tests\\Program', ...options,
  ], { encoding: 'utf8' });
}

// A file of a fixed content in a directory of the test, as the asset build writes build.json.
function buildFile(directory: string, text: string) {
  const file = join(directory, 'build.json');
  writeFileSync(file, text);
  return file;
}

test('writes build.json with the same bytes as the --build file into the program directory (HY-125)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-server-build-'));
  try {
    const text = `{"build":"${id}"}`;
    const file = buildFile(directory, text);
    const output = join(directory, 'server');
    const result = server(output, '--build', file);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(output, 'build.json'), 'utf8'), text);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails and names the option when --build is missing (HY-125)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-server-build-'));
  try {
    const output = join(directory, 'server');
    const result = server(output);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--build/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails with the path when --build is not an absolute path (HY-125)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-server-build-'));
  try {
    const output = join(directory, 'server');
    const result = server(output, '--build', 'build.json');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /absolute/);
    assert.match(result.stderr, /build\.json/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Runs the server build with a build file of the given content, or with a missing file, and expects its refusal with the path. */
function refusesBuild(content: string | undefined): void {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-server-build-'));
  try {
    const file = content === undefined ? join(directory, 'missing', 'build.json') : buildFile(directory, content);
    const output = join(directory, 'server');
    const result = server(output, '--build', file);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(file), result.stderr);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('fails with the absolute path of a missing --build file (HY-125)', () => {
  refusesBuild(undefined);
});

test('builds a template placed with scope arguments, which keeps its inputs (HY-73.16)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-server-build-'));
  try {
    const templates = join(directory, 'templates');
    cpSync(join(fixtures, 'templates'), templates, { recursive: true });
    writeFileSync(join(templates, 'box.tpl'), '<b>{= item.title}</b>');
    writeFileSync(join(templates, 'page.tpl'), `<p>{= title}|{= name}{? error} !{= error}{/}</p>\n{# box.tpl item:post}`);
    const output = join(directory, 'server');
    const result = spawnSync(process.execPath, [
      'packages/build/bin/hyper-build-server.mjs', '--manifest', join(fixtures, 'app.json'), '--templates', templates,
      '--output', output, '--php-namespace', 'Polyspec\\Hyper\\Server\\Tests\\Program', '--build', buildFile(directory, `{"build":"${id}"}`),
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(output, 'php', 'GeneratedProgram.php')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails with the path when the build id is not 64 lowercase hexadecimal characters (HY-125)', () => {
  refusesBuild('{"build":"ABC"}');
});

test('fails with the path when the file holds another key besides build (HY-125)', () => {
  refusesBuild(`{"build":"${id}","other":"x"}`);
});
