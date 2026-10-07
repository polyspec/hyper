// Tests the symptom of HY-68 where it exists, on Darwin with Apple `container` (`make virtiofs-check`, a target of
// the full suite on Darwin only): the build scripts write their output files on a virtiofs bind mount of a Linux
// container. tests/scripts/output-files.test.mjs tests the cause, the modes of the outputs, on every platform. The bind mounts of Apple `container` are virtiofs, which refuses to create a
// file with a mode that its owner cannot read, such as the mode 0200 with which `fs.cpSync` of
// Node creates its destination files. The test runs the scripts in the official Node image with
// a temporary output directory of the test mounted writable, which the test removes; a missing
// `container` command fails the test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const image = 'docker.io/library/node:26.8.1-trixie-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146';

// Runs node with `args` in the container with a temporary output directory of the test mounted as /output.
function run(t, args) {
  const output = mkdtempSync(join(tmpdir(), 'hyper-virtiofs-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  // The declared copy of the template repository lies inside this checkout (HY-78).
  if (!template.startsWith(`${root}/`)) throw new Error(`${template} is not inside ${root}`);
  const mounts = [
    ['--mount', `type=bind,source=${root},target=${root},readonly`],
    ['--mount', `type=bind,source=${output},target=/output`],
  ].flat();
  const result = spawnSync('container', ['run', '--rm', ...mounts, image, 'node', ...args], { encoding: 'utf8' });
  if (result.error) throw new Error(`container cannot run: ${result.error.message}`);
  return { ...result, output };
}

function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? files(directory, name) : [name];
  }).sort();
}

test('the server build writes the templates on a virtiofs bind mount', { timeout: 120000 }, (t) => {
  const templates = join(root, 'examples', 'board', 'templates');
  const result = run(t, [
    join(root, 'packages', 'hyper-build', 'bin', 'hyper-build-server.mjs'),
    '--manifest', join(root, 'examples', 'board', 'app', 'app.json'),
    '--templates', templates,
    '--output', '/output/server',
    '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
  ]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const { output } = result;
  const copied = join(output, 'server', 'templates');
  for (const name of files(templates)) {
    assert.deepEqual(readFileSync(join(copied, name)), readFileSync(join(templates, name)), name);
    assert.equal(statSync(join(copied, name)).mode & 0o777, 0o644, name);
  }
  assert.ok(files(copied).includes('hyper/data.tpl'));
  // HY-73: the read paths of every route, computed without a bundler in the container.
  const reads = JSON.parse(readFileSync(join(output, 'server', 'reads.json'), 'utf8')).routes;
  assert.deepEqual(Object.keys(reads).sort(), JSON.parse(readFileSync(join(root, 'examples', 'board', 'app', 'app.json'), 'utf8')).routes.map((route) => route.name).sort());
});

test('the output copies write a directory and a file on a virtiofs bind mount', { timeout: 120000 }, (t) => {
  const source = join(root, 'examples', 'board', 'templates');
  const script = [
    `import { copyDirectory, copyFile } from ${JSON.stringify(join(root, 'packages', 'hyper-build', 'lib', 'output-files.mjs'))};`,
    `copyDirectory(${JSON.stringify(source)}, '/output/directory');`,
    `copyFile(${JSON.stringify(join(source, 'layout.tpl'))}, '/output/file/layout.tpl');`,
  ].join('\n');
  const result = run(t, ['--input-type=module', '--eval', script]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const { output } = result;
  assert.deepEqual(files(join(output, 'directory')), files(source));
  assert.deepEqual(readFileSync(join(output, 'file', 'layout.tpl')), readFileSync(join(source, 'layout.tpl')));
  assert.equal(statSync(join(output, 'file', 'layout.tpl')).mode & 0o777, 0o644);
});
