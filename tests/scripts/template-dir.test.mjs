// Tests that the asset build and the template build read the template package of the template repository that
// the caller names, not the template package that this repository installed (HY-70).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { bundlePackage } from '../../scripts/template-files.mjs';

const repository = resolve('.');
const installed = resolve('..', 'template', 'packages', 'template-ts');

// A template repository with a copy of the template package of the template repository next to this one.
function templateDir(withBuild) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-dir-'));
  const target = join(directory, 'packages', 'template-ts');
  mkdirSync(target, { recursive: true });
  cpSync(join(installed, 'package.json'), join(target, 'package.json'));
  if (withBuild) cpSync(join(installed, 'dist'), join(target, 'dist'), { recursive: true });
  return directory;
}

test('bundles the browser package with the template package of the named template repository', async () => {
  const directory = templateDir(true);
  try {
    const inputs = Object.keys((await bundlePackage(directory)).metafile.inputs).map((input) => resolve(input));
    const template = join(directory, 'packages', 'template-ts');
    assert.ok(inputs.some((input) => input.startsWith(`${template}/dist/`)), inputs.join('\n'));
    assert.deepEqual(inputs.filter((input) => input.startsWith(`${installed}/`)), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the template build fails when the named template repository has no build of its template package', () => {
  const directory = templateDir(false);
  const output = mkdtempSync(join(tmpdir(), 'hyper-template-output-'));
  try {
    const result = spawnSync(process.execPath, [join(repository, 'scripts', 'build-templates.mjs'),
      '--templates', join(repository, 'examples', 'board', 'templates'), '--output', output, '--template-dir', directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(join(directory, 'packages', 'template-ts', 'dist')), result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test('the asset build and the template build require --template-dir', () => {
  const runs = {
    'build-assets.mjs': ['--app', 'examples/board', '--api', '/api', '--output', '/nonexistent'],
    'build-templates.mjs': ['--templates', 'examples/board/templates', '--output', '/nonexistent'],
  };
  for (const [script, options] of Object.entries(runs)) {
    const result = spawnSync(process.execPath, [join(repository, 'scripts', script), ...options], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, script);
    assert.match(result.stderr, /--template-dir/, script);
  }
});
