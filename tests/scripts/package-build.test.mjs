// Tests that each npm package of this repository declares a build that runs the TypeScript compiler by the path of
// its package (scripts/tsc.mjs, HY-79): npm installs no bin links, so `npm exec tsc` finds no command, and a package
// is built with `npm run build` in its directory. The test builds each package into a temporary directory and leaves
// dist unchanged; `npm run tsc -- <tsc arguments>` runs the compiler with the arguments of the call, such as a project
// file. Run it after `make install`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { NPM } from '../../scripts/toolchain.mjs';
import { requireBuilt } from './requires.mjs';

requireBuilt('install', 'node_modules/typescript/package.json', 'var/tools/bin/npm');
requireBuilt('packages', 'node_modules/@polyspec/hyper/dist/index.d.ts');

for (const directory of ['packages/hyper-js', 'packages/hyper-node']) {
  test(`npm run build compiles ${directory} without a bin link`, { timeout: 60_000 }, (t) => {
    const output = mkdtempSync(join(tmpdir(), 'hyper-package-build-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const exec = spawnSync(NPM, ['exec', '--offline', '--no', '--', 'tsc', '--version'], { cwd: resolve(directory), encoding: 'utf8' });
    assert.notEqual(exec.status, 0, 'npm found a tsc command; the checkout installed bin links');
    const build = spawnSync(NPM, ['run', '--silent', 'build', '--', '--outDir', output], { cwd: resolve(directory), encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
    assert.ok(existsSync(join(output, 'index.js')), output);
    assert.ok(existsSync(join(output, 'index.d.ts')), output);
  });

  test(`npm run tsc runs the compiler of ${directory} with the arguments of the call`, { timeout: 60_000 }, (t) => {
    const output = mkdtempSync(join(tmpdir(), 'hyper-package-tsc-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const tsc = spawnSync(NPM, ['run', '--silent', 'tsc', '--', '-p', 'tsconfig.build.json', '--outDir', output], { cwd: resolve(directory), encoding: 'utf8' });
    assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
    assert.ok(existsSync(join(output, 'index.js')), output);
  });
}
