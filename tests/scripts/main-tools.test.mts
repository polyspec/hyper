// Tests that the recipes start the tools of the main checkout, the var/tools that kit.mk names $(KIT_TOOLS) (HR-81, kit
// K519): a linked worktree that make worktree-setup makes installs no tools and runs those of the main checkout, so npm,
// Composer, uv and the first entry of PATH name the main checkout in a worktree as on main.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The var/tools of the main checkout of ROOT: the folder of the common Git directory, which a linked worktree shares. */
function mainTools(): string {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `git rev-parse --git-common-dir in ${ROOT}: ${result.stderr}`);
  return path.join(realpathSync(path.dirname(result.stdout.trim())), 'var', 'tools');
}

test('npm, Composer, uv and the first entry of PATH are the tools of the main checkout (kit K519)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-main-tools-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const extra = path.join(directory, 'tools.mk');
  writeFileSync(extra, 'hyper-tool-paths:\n\t@echo NPM=$(NPM)\n\t@echo COMPOSER=$(COMPOSER)\n\t@echo UV=$(UV)\n\t@echo PATH=$$PATH\n');
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const result = spawnSync('make', ['--no-print-directory', '-s', '-f', 'Makefile', '-f', extra, 'hyper-tool-paths'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  const values = Object.fromEntries(result.stdout.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const tools = mainTools();
  assert.deepEqual(
    { NPM: values.NPM, COMPOSER: values.COMPOSER, UV: values.UV, PATH: values.PATH?.split(':')[0] },
    { NPM: path.join(tools, 'bin', 'npm'), COMPOSER: path.join(tools, 'mise', 'shims', 'composer'), UV: path.join(tools, 'mise', 'shims', 'uv'), PATH: path.join(tools, 'bin') },
    result.stdout,
  );
});
