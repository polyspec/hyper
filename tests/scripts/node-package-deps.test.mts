// Tests that node-package writes the packed production closure, var/bindings/node/deps, anew on every run (HR-82,
// H35.68): the install of the packed package installs every file of deps, so a file that an earlier run packed, such as
// a release of a dependency that the lock no longer pins, would be installed beside the new one. The test leaves such a
// file in deps, runs the lines of the recipe that write deps with an npm that packs a file named after the directory
// that it packs, and expects deps to hold only the files of this run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

test('node-package writes deps from the closure of this run and keeps no packed file of an earlier run (HR-82, H35.68)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-node-package-deps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bindings = path.join(root, 'bindings');
  const deps = path.join(bindings, 'node', 'deps');
  mkdirSync(deps, { recursive: true });
  writeFileSync(path.join(deps, 'stale-0.0.1.tgz'), 'an earlier run');
  // `npm pack --pack-destination <directory>` in a package directory writes <name of the directory>.tgz there.
  const npm = path.join(root, 'npm');
  writeFileSync(npm, ['#!/bin/sh', 'while [ "$1" != "--pack-destination" ]; do shift; done', 'touch "$2/$(basename "$PWD").tgz"', ''].join('\n'));
  chmodSync(npm, 0o755);

  // A recipe line that a backslash continues prints as several lines; each command is joined back into one.
  const commands = dryRun('node-package', { variables: [`BINDINGS_VAR=${bindings}`, `NPM=${npm}`] })
    .join('\n')
    .replaceAll('\\\n', '\n')
    .split(/(?<!\n)\n(?![\t ])/u);
  const lines = commands.filter((line) => line.includes(deps));
  assert.ok(lines.some((line) => line.includes('--pack-destination')), `node-package packs nothing into ${deps}:\n${lines.join('\n')}`);
  for (const line of lines) {
    const run = spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${line}\n${run.stdout}${run.stderr}`);
  }
  const files = readdirSync(deps);
  assert.ok(!files.includes('stale-0.0.1.tgz'), `deps keeps the file of an earlier run: ${files.join(' ')}`);
  assert.ok(files.length > 0 && files.every((file) => file.endsWith('.tgz')), `deps holds no packed closure: ${files.join(' ')}`);
  assert.deepEqual(readdirSync(path.join(bindings, 'node')).filter((name) => name !== 'deps'), [], 'the run leaves its staging directory');
});
