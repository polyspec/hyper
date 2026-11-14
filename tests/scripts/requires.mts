// The inputs that a test reads and does not create (HR-85): a build or an install of another target. A test names
// them with requireBuilt before it reads them, so a missing input fails with its path and the target that makes it,
// not with an error of the tool that reads it.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Fails unless the checkout holds the Node binding of the core, which every Node server of the checkout reads through
 * packages/ts/src/core/binding.ts: the generated entry and the addon of this platform beside it, which `make node-addon`
 * writes. A test that starts a Node server calls it beside its other requirements.
 */
export function requireNodeAddon(): void {
  const platform = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
  requireBuilt('node-addon', 'packages/ts/native/generated/index.cjs', `packages/ts/native/generated/hyper.${platform}.node`);
}

/** Fails unless every path of `paths`, relative to the checkout, exists; names the make target that writes them. */
export function requireBuilt(target: string, ...paths: string[]): void {
  const missing = paths.filter((file) => !existsSync(path.resolve(ROOT, file)));
  assert.deepEqual(missing, [], `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing; \`make ${target}\` writes ${missing.length === 1 ? 'it' : 'them'}, and \`make hyper-test-scripts\` runs it first`);
}
