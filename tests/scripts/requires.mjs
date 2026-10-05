// The inputs that a test reads and does not create (HY-85): a build or an install of another target. A test names
// them with requireBuilt before it reads them, so a missing input fails with its path and the target that makes it,
// not with an error of the tool that reads it.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Fails unless every path of `paths`, relative to the checkout, exists; names the make target that writes them. */
export function requireBuilt(target, ...paths) {
  const missing = paths.filter((file) => !existsSync(path.resolve(ROOT, file)));
  assert.deepEqual(missing, [], `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing; \`make ${target}\` writes ${missing.length === 1 ? 'it' : 'them'}, and \`make test-scripts\` runs it first`);
}
