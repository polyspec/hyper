// Tests `make node-package` (H35.7): it packs the dependencies of packages/ts from the root install and installs them
// with the packed package, since an offline install of the packed package finds no registry for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

test('node-package packs the dependencies of packages/ts and installs them with the package (H35.7)', () => {
  const lines = dryRun('node-package').join('\n');
  assert.match(lines, /node_modules\/\$dependency && \S+ pack --pack-destination \S+\/node\/deps/u, lines);
  assert.match(lines, /install --no-audit --no-fund --omit=optional \.\/deps\/\*\.tgz \.\/polyspec-hyper-/u, lines);
});
