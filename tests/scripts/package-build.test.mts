// Tests that each npm package of this repository builds with the TypeScript compiler that npm links into node_modules/.bin
// (HR-79): npm installs with its own defaults, so `npm exec tsc` finds the compiler, and a package is built with
// `npm run build` in its directory. The test builds each package into a temporary directory and leaves dist unchanged.
// Run it after `make hyper-install`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mts';

// The npm of this checkout, which `make install-tools` writes (HR-81).
const NPM = resolve('var/tools/bin/npm');
requireBuilt('hyper-install', 'node_modules/typescript/package.json', 'var/tools/bin/npm');

for (const directory of ['packages/client', 'packages/server/ts']) {
  test(`npm exec finds the tsc of the bin link of npm in ${directory}`, { timeout: 60_000 }, () => {
    const exec = spawnSync(NPM, ['exec', '--offline', '--no', '--', 'tsc', '--version'], { cwd: resolve(directory), encoding: 'utf8' });
    assert.equal(exec.status, 0, `${exec.stdout}${exec.stderr}`);
    assert.match(exec.stdout, /^Version 7\.0\.2/);
  });

  test(`npm run build compiles ${directory}`, { timeout: 60_000 }, (t) => {
    const output = mkdtempSync(join(tmpdir(), 'hyper-package-build-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const build = spawnSync(NPM, ['run', '--silent', 'build', '--', '--outDir', output], { cwd: resolve(directory), encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
    assert.ok(existsSync(join(output, 'index.js')), output);
    assert.ok(existsSync(join(output, 'index.d.ts')), output);
  });
}
