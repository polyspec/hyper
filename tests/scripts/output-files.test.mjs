// Tests that the build scripts write their output files on a virtiofs bind mount of a Linux
// container (HY-68). The bind mounts of Apple `container` are virtiofs, which refuses to create a
// file with a mode that its owner cannot read, such as the mode 0200 with which `fs.cpSync` of
// Node creates its destination files. The test runs the scripts in the official Node image with
// the output directory tests/scripts/build/virtiofs mounted writable; a missing `container`
// command fails the test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const template = resolve(root, '..', 'template');
const output = join(root, 'tests', 'scripts', 'build', 'virtiofs');
const image = 'docker.io/library/node:26.8.1-trixie-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146';

function run(args) {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const mounts = [
    ['--mount', `type=bind,source=${root},target=${root},readonly`],
    ['--mount', `type=bind,source=${template},target=${template},readonly`],
    ['--mount', `type=bind,source=${output},target=/output`],
  ].flat();
  const result = spawnSync('container', ['run', '--rm', ...mounts, image, 'node', ...args], { encoding: 'utf8' });
  if (result.error) throw new Error(`container cannot run: ${result.error.message}`);
  return result;
}

function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? files(directory, name) : [name];
  }).sort();
}

test('the server build writes the templates on a virtiofs bind mount', { timeout: 120000 }, () => {
  const templates = join(root, 'examples', 'board', 'templates');
  const result = run([
    join(root, 'scripts', 'build-server.mjs'),
    '--manifest', join(root, 'examples', 'board', 'app', 'app.json'),
    '--templates', templates,
    '--output', '/output/server',
    '--template-dir', template,
    '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
  ]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const copied = join(output, 'server', 'templates');
  for (const name of files(templates)) {
    assert.deepEqual(readFileSync(join(copied, name)), readFileSync(join(templates, name)), name);
    assert.equal(statSync(join(copied, name)).mode & 0o777, 0o644, name);
  }
  assert.ok(files(copied).includes('hyper/data.tpl'));
});

test('the output copies write a directory and a file on a virtiofs bind mount', { timeout: 120000 }, () => {
  const source = join(root, 'examples', 'board', 'templates');
  const script = [
    `import { copyDirectory, copyFile } from ${JSON.stringify(join(root, 'scripts', 'output-files.mjs'))};`,
    `copyDirectory(${JSON.stringify(source)}, '/output/directory');`,
    `copyFile(${JSON.stringify(join(source, 'layout.tpl'))}, '/output/file/layout.tpl');`,
  ].join('\n');
  const result = run(['--input-type=module', '--eval', script]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(files(join(output, 'directory')), files(source));
  assert.deepEqual(readFileSync(join(output, 'file', 'layout.tpl')), readFileSync(join(source, 'layout.tpl')));
  assert.equal(statSync(join(output, 'file', 'layout.tpl')).mode & 0o777, 0o644);
});
