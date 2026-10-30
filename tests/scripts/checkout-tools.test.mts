// Tests that the recipes start the tools of the checkout, the var/tools that kit.mk names $(KIT_TOOLS) (HR-81, kit
// K858): a linked worktree installs and runs its own tools, so npm, Composer, uv and the first entry of PATH name the
// var/tools of the checkout, in a worktree as on main.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkoutTools } from './checkout-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('npm, Composer, uv and the first entry of PATH are the tools of the checkout (kit K858)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-checkout-tools-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const extra = path.join(directory, 'tools.mk');
  writeFileSync(extra, 'hyper-tool-paths:\n\t@echo NPM=$(NPM)\n\t@echo COMPOSER_BIN=$(COMPOSER_BIN)\n\t@echo UV=$(UV)\n\t@echo PATH=$$PATH\n');
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const result = spawnSync('make', ['--no-print-directory', '-s', '-f', 'Makefile', '-f', extra, 'hyper-tool-paths'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  const values = Object.fromEntries(result.stdout.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const tools = checkoutTools(ROOT);
  assert.deepEqual(
    { NPM: values.NPM, COMPOSER_BIN: values.COMPOSER_BIN, UV: values.UV, PATH: values.PATH?.split(':')[0] },
    { NPM: path.join(tools, 'bin', 'npm'), COMPOSER_BIN: path.join(tools, 'mise', 'shims', 'composer'), UV: path.join(tools, 'mise', 'shims', 'uv'), PATH: path.join(tools, 'bin') },
    result.stdout,
  );
});
