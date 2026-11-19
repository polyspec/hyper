// Tests that the install targets run without the node of var/tools (H35.116). A fresh checkout has no var/tools/bin/node
// until make install-tools TOOLS=npm installs it, and the first make after make bootstrap finds the binding generator in
// node_modules. That make used to rewrite packages/release.mk with var/tools/bin/node before it ran any target, so the
// install target failed with "No such file or directory". An install goal does not read the release recipes, so the
// Makefile does not rewrite them for it. Each test runs the Makefile in a directory of its own (HR-85), and reads the
// commands that make would run with a dry run (HR-83).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A checkout after make bootstrap: the Makefile and the binding generator of node_modules, and no var/tools. */
function freshCheckout(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-install-order-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync(path.join(ROOT, 'Makefile'), path.join(directory, 'Makefile'));
  const binding = path.join(directory, 'node_modules', '@polyspec', 'binding', 'dist');
  mkdirSync(binding, { recursive: true });
  writeFileSync(path.join(binding, 'cli.js'), '');
  return directory;
}

for (const goal of ['bootstrap', 'install-tools', 'install-packages']) {
  test(`${goal} runs without the node of var/tools and writes no release recipe (H35.116)`, (t) => {
    const cwd = freshCheckout(t);
    const variables = goal === 'install-tools' ? ['TOOLS=npm'] : [];
    const lines = dryRun(goal, { cwd, variables });
    assert.equal(
      lines.some((line) => line.includes('release-recipes')),
      false,
      `${goal} must not start release-recipes before its install: ${lines.join(' | ')}`,
    );
  });
}
