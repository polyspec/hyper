// Tests the symptom of HR-68 where it exists, on Darwin with Apple `container` (`make virtiofs-check`, a target of
// the full suite on Darwin only): the build scripts write their output files on a virtiofs bind mount of a Linux
// container. tests/scripts/output-files.test.mts tests the cause, the modes of the outputs, on every platform. The bind mounts of Apple `container` are virtiofs, which refuses to create a
// file with a mode that its owner cannot read, such as the mode 0200 with which `fs.cpSync` of
// Node creates its destination files. The test runs the scripts in the official Node image with
// a temporary output directory of the test mounted writable, which the test removes; a missing
// `container` command fails the test. The rule is about the creation of the files, not their content: the image holds
// Node and no native addon of the template library or of the core, so the container runs only the writes of the build
// (packages/cli/lib/program-files.mjs, packages/cli/lib/output-files.mjs), and the test computes the content of the
// program on the host with the function of the build.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { writeProgramTemplates } from '../../packages/cli/lib/program-files.mjs';
import { programFiles } from '../../packages/cli/lib/program.mjs';
import { requireBuilt } from '../scripts/requires.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const image = /^VIRTIOFS_IMAGE := (\S+)$/m.exec(readFileSync(join(root, 'Makefile'), 'utf8'))?.[1];

// Runs node with `args` in the container with a temporary output directory of the test mounted as /output and, when
// the test passes one, its directory `input` mounted read-only as /input.
function run(t: TestContext, args: string[], input?: string) {
  assert.ok(image, 'Makefile declares no VIRTIOFS_IMAGE');
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  // Native package source links retain their absolute targets in the container. Discover the provider checkout
  // from each resolved package entry with Git, and mount it read-only at the same path (HR-70, HR-78).
  const entries = [
    createRequire(join(root, 'packages/cli/package.json')).resolve('@polyspec/template'),
    fileURLToPath(import.meta.resolve('@polyspec/template-compiler/compiler.mjs')),
  ];
  const sources = new Set([root]);
  for (const entry of entries) {
    if (entry.startsWith(`${root}/`)) continue;
    sources.add(execFileSync('git', ['-C', dirname(entry), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  }
  const installed = spawnSync('container', ['image', 'inspect', image], { encoding: 'utf8' });
  if (installed.error) throw new Error(`container cannot run: ${installed.error.message}`);
  assert.equal(installed.status, 0, `${image} is missing; make hyper-install-virtiofs installs it:\n${installed.stdout}${installed.stderr}`);
  const output = mkdtempSync(join(tmpdir(), 'hyper-virtiofs-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const mounts = [
    ...[...sources].map((source) => ['--mount', `type=bind,source=${source},target=${source},readonly`]),
    ...(input === undefined ? [] : [['--mount', `type=bind,source=${input},target=/input,readonly`]]),
    ['--mount', `type=bind,source=${output},target=/output`],
  ].flat();
  const result = spawnSync('container', ['run', '--rm', '--arch', 'arm64', ...mounts, image, 'node', ...args], { encoding: 'utf8' });
  if (result.error) throw new Error(`container cannot run: ${result.error.message}`);
  return { ...result, output };
}

function files(directory: string, prefix = ''): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry): string[] => {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? files(directory, name) : [name];
  }).sort();
}

test('the program of hyper build writes its files on a virtiofs bind mount', { timeout: 120000 }, (t) => {
  const templates = join(root, 'examples', 'board', 'templates');
  const manifestFile = join(root, 'examples', 'board', 'app', 'app.json');
  const id = '1'.repeat(64);
  // The content of the program is computed here, on the host, with the function of the build (programFiles of
  // packages/cli/lib/program.mjs), which loads the native addons of the host; the container holds no addon.
  requireBuilt('packages node-addon', 'packages/ts/dist/build.js', `packages/ts/native/generated/hyper.${process.platform}-${process.arch}.node`);
  const input = mkdtempSync(join(tmpdir(), 'hyper-virtiofs-input-'));
  t.after(() => rmSync(input, { recursive: true, force: true }));
  const manifest: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const computed = programFiles({ manifest, templates: writeProgramTemplates(templates, join(input, 'program')), phpNamespace: 'Polyspec\\Hyper\\Examples\\Board\\Program' });
  const names = computed.files.map(([name]) => name);
  assert.ok(names.includes('reads.json') && names.includes('program.json') && names.some((name) => name.startsWith('php/')), names.join(', '));
  writeFileSync(join(input, 'files.json'), JSON.stringify(computed.files));
  // The writes of the build (packages/cli/lib/program-files.mjs, which writeProgram calls), into the bind mount.
  const script = [
    `import { readFileSync } from 'node:fs';`,
    `import { writeBuildFile, writeProgramFiles, writeProgramTemplates } from ${JSON.stringify(join(root, 'packages', 'cli', 'lib', 'program-files.mjs'))};`,
    `writeProgramTemplates(${JSON.stringify(templates)}, '/output/program');`,
    `writeProgramFiles('/output/program', JSON.parse(readFileSync('/input/files.json', 'utf8')));`,
    `writeBuildFile('/output/program', '${id}');`,
  ].join('\n');
  const result = run(t, ['--input-type=module', '--eval', script], input);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const { output } = result;
  const copied = join(output, 'program', 'templates');
  for (const name of files(templates)) {
    assert.deepEqual(readFileSync(join(copied, name)), readFileSync(join(templates, name)), name);
    assert.equal(statSync(join(copied, name)).mode & 0o777, 0o644, name);
  }
  // HY-31.9, HY-31.10: the copy of the reserved template lies below legacy/ and not below templates/.
  assert.equal(files(copied).includes('hyper/data.tpl'), false);
  // Every file of the program is on the mount with the content that the host computed, and no other file.
  assert.deepEqual(files(join(output, 'program')), [...files(copied).map((name) => `templates/${name}`), 'legacy/hyper/data.tpl', ...names, 'build.json'].sort());
  for (const [name, content] of computed.files) assert.equal(readFileSync(join(output, 'program', name), 'utf8'), content, name);
  assert.equal(readFileSync(join(output, 'program', 'build.json'), 'utf8'), `{"build":"${id}"}`);
});

test('the output copies write a directory and a file on a virtiofs bind mount', { timeout: 120000 }, (t) => {
  const source = join(root, 'examples', 'board', 'templates');
  const script = [
    `import { copyDirectory, copyFile } from ${JSON.stringify(join(root, 'packages', 'cli', 'lib', 'output-files.mjs'))};`,
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
