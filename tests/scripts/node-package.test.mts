// Tests `make node-package` (H35.7): it packs the dependencies of packages/ts from the root install and installs them
// with the packed package, since an offline install of the packed package finds no registry for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependencyClosure } from '../../scripts/dependency-closure.mts';
import { dryRun } from './make-dry-run.mts';

test('node-package packs the dependencies of packages/ts and installs them with the package (H35.7)', () => {
  const lines = dryRun('node-package').join('\n');
  assert.match(lines, /node_modules\/\$dependency && \S+ pack --pack-destination \S+\/node\/deps/u, lines);
  assert.match(lines, /install --no-audit --no-fund --omit=optional \.\/deps\/\*\.tgz \.\/polyspec-hyper-/u, lines);
});

// H34.12: a dependency of a packed dependency, such as eventsource-parser of @polyspec/hyper-client, is packed too, because
// the offline install resolves an unpacked one through registry metadata, which npm ci never puts in the cache.
test('node-package packs the production closure of packages/ts that package-lock.json names (H34.12)', () => {
  const lines = dryRun('node-package').join('\n');
  assert.match(lines, /scripts\/dependency-closure\.mts --lock package-lock\.json --workspace packages\/ts/u, lines);
});

test('the closure follows a linked workspace into its dependencies, each name once (H34.12)', () => {
  const packages = {
    'packages/ts': { dependencies: { '@polyspec/hyper-client': '0.0.40', '@polyspec/template': '0.0.30' } },
    'node_modules/@polyspec/hyper-client': { resolved: 'packages/client', link: true },
    'packages/client': { dependencies: { '@polyspec/template': '0.0.30', 'eventsource-parser': '4.1.3' } },
    'node_modules/@polyspec/template': {},
    'node_modules/eventsource-parser': {},
  };
  assert.deepEqual(dependencyClosure(packages, 'packages/ts'), ['@polyspec/hyper-client', '@polyspec/template', 'eventsource-parser']);
  assert.throws(() => dependencyClosure({ 'packages/ts': { dependencies: { absent: '1' } } }, 'packages/ts'), /no entry node_modules\/absent/u);
});
