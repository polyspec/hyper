// A tree without packages/release.mk for the tests of a target that reads a variable or a recipe of that file: the
// Makefile and the files that `binding release-recipes` reads, copied into a directory of the test (HR-85), which the
// test removes at its end, and the variables with which a dry run in the copy starts the Node.js and the binding
// generator of the checkout.
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function treeWithoutReleaseRecipes(t: TestContext, prefix: string): { tree: string; variables: string[] } {
  requireBuilt('install-packages', 'node_modules/@polyspec/binding/dist/cli.js');
  requireBuilt('install-tools', 'var/tools/bin/node');
  // The real path, which make prints as $(CURDIR): on macOS tmpdir() is below /var, a link to /private/var (H35.50).
  const tree = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  for (const file of ['Makefile', 'config/toolchain.json', 'packages/rust/interface.json', 'packages/ts/package.json', 'packages/go/go.mod']) {
    mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(tree, file));
  }
  const variables = [`NODE=${path.join(ROOT, 'var/tools/bin/node')}`, `BINDING=${path.join(ROOT, 'node_modules/@polyspec/binding/dist/cli.js')}`];
  return { tree, variables };
}
