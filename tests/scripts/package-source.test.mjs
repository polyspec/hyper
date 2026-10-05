// Tests that the build scripts read the browser package from its source in this repository, from any working
// directory, so that a build does not depend on the build output in packages/hyper-js/dist (HY-61).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { bundlePackage } from '../../scripts/template-files.mjs';
import { templateDir } from './declared-template.mjs';

const repository = resolve('.');

test('bundles the browser package from its source', async () => {
  const inputs = Object.keys((await bundlePackage(templateDir)).metafile.inputs).map((input) => resolve(input));
  assert.deepEqual(inputs.filter((input) => input.startsWith(join(repository, 'packages', 'hyper-js', 'dist'))), []);
  assert.ok(inputs.some((input) => input.startsWith(join(repository, 'packages', 'hyper-js', 'src'))), inputs.join('\n'));
});

test('builds the templates and the server program from another working directory', () => {
  const output = mkdtempSync(join(tmpdir(), 'hyper-scripts-'));
  try {
    const board = join(repository, 'examples', 'board');
    const templates = spawnSync(process.execPath, [join(repository, 'scripts', 'build-templates.mjs'), '--templates', join(board, 'templates'), '--output', join(output, 'templates'),
      '--template-dir', templateDir], { cwd: output, encoding: 'utf8' });
    assert.equal(templates.status, 0, templates.stderr);
    const server = spawnSync(process.execPath, [
      join(repository, 'scripts', 'build-server.mjs'), '--manifest', join(board, 'app', 'app.json'), '--templates', join(board, 'templates'),
      '--output', join(output, 'server'), '--template-dir', templateDir, '--php-namespace', 'Polyspec\\Hyper\\Examples\\Board\\Program',
    ], { cwd: output, encoding: 'utf8' });
    assert.equal(server.status, 0, server.stderr);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
