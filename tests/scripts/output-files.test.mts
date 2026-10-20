// Tests the cause that HR-68 guards against, on every platform: the output copies give every file the mode 0644 and
// every directory the mode 0755 whatever the umask of the process, also over an existing file of another mode, so a
// process of another user can read them. A virtiofs bind mount of a Linux container refused a file that its owner
// could not read; that symptom is tested where it exists, with Apple `container` on Darwin
// (tests/virtiofs/output-files.test.mts, `make virtiofs-check`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_FILES = join(root, 'packages', 'build', 'lib', 'output-files.mjs');

function temporary(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-output-modes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Another user reaches the outputs through this directory.
  chmodSync(directory, 0o755);
  return directory;
}

// Every entry below `directory` with its mode.
function modes(directory: string, prefix = ''): [string, number][] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry): [string, number][] => {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const mode = statSync(join(directory, name)).mode & 0o777;
    return entry.isDirectory() ? [[`${name}/`, mode], ...modes(directory, name)] : [[name, mode]];
  });
}

// Writes the outputs of the copies in a process with the umask 077, which leaves only the owner any permission.
function writeOutputs(t: TestContext) {
  const directory = temporary(t);
  const source = join(directory, 'source');
  mkdirSync(join(source, 'nested'), { recursive: true });
  writeFileSync(join(source, 'a.tpl'), 'a');
  writeFileSync(join(source, 'nested', 'b.tpl'), 'b');
  const output = join(directory, 'output');
  mkdirSync(join(output, 'file'), { recursive: true, mode: 0o755 });
  chmodSync(output, 0o755);
  chmodSync(join(output, 'file'), 0o755);
  // An earlier output of another mode is written again.
  writeFileSync(join(output, 'file', 'a.tpl'), 'old', { mode: 0o600 });
  const script = [
    `import { copyDirectory, copyFile, writeFileAtomic } from ${JSON.stringify(OUTPUT_FILES)};`,
    `copyDirectory(${JSON.stringify(source)}, ${JSON.stringify(join(output, 'directory', 'deep'))});`,
    `copyFile(${JSON.stringify(join(source, 'a.tpl'))}, ${JSON.stringify(join(output, 'file', 'a.tpl'))});`,
    `copyFile(${JSON.stringify(join(source, 'a.tpl'))}, ${JSON.stringify(join(output, 'new', 'path', 'a.tpl'))});`,
    `writeFileAtomic(${JSON.stringify(join(output, 'atomic', 'manifest.json'))}, '{}');`,
  ].join('\n');
  const run = spawnSync('/bin/sh', ['-c', 'umask 077 && exec "$0" --input-type=module -e "$1"', process.execPath, script], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  return output;
}

test('the output copies give files the mode 0644 and directories 0755 under the umask 077 (HR-68)', (t) => {
  const output = writeOutputs(t);
  const found = modes(output);
  assert.deepEqual(found.map(([name]) => name).sort(), ['atomic/', 'atomic/manifest.json', 'directory/', 'directory/deep/', 'directory/deep/a.tpl', 'directory/deep/nested/', 'directory/deep/nested/b.tpl', 'file/', 'file/a.tpl', 'new/', 'new/path/', 'new/path/a.tpl']);
  const wrong = found.filter(([name, mode]) => mode !== (name.endsWith('/') ? 0o755 : 0o644)).map(([name, mode]) => `${name} ${mode.toString(8)}`);
  assert.deepEqual(wrong, []);
});
