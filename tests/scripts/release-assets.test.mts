// Tests that each package of a release is built by the step that can build it (HR-95, H35.35-2 to H35.35-4).
// config/release.json names the packages that `release assets` of kit packs: an npm package with `npm pack` of the files
// of the checkout, a Composer package as the zip of its directory at the commit, and a wheel as a pure Python wheel from
// the archive of its directory alone. A package that holds a native part is built by a target of packages/release.mk in
// a job of .github/workflows/assets.yml, on the runner of each platform, and is no package of kit. The declarations are
// read as they are tracked; the dry runs name the targets that the jobs run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

interface ReleasePackage { kind: string; directory: string; name: string; product: string; runtime: string }
interface ReleaseConfig { packages: ReleasePackage[]; manifests: Record<string, string>; notReleased: Record<string, string> }

const config = JSON.parse(read('config/release.json')) as ReleaseConfig;

// The makes that the recipe of a job of assets.yml starts, and the command lines of the build that it ends with.
const started = (recipe: string, variables: string[] = []): string[] => dryRun(recipe, { variables }).map((line) => / --no-print-directory ([a-z][\w-]*)/.exec(line)?.[1]).filter((target) => target !== undefined);

test('H35.35-2 no wheel of kit is a package with a native build backend, and the job platform builds the wheel of packages/python', () => {
  // kit builds the kind wheel from a git archive of the directory alone and requires the name of a pure Python wheel, so a
  // package whose backend compiles a crate outside that archive does not build there and is named for its platform.
  const native = config.packages.filter((item) => item.kind === 'wheel').filter((item) => /^build-backend = "maturin"$/m.test(read(`${item.directory}/pyproject.toml`)));
  assert.deepEqual(native.map((item) => `${item.directory}: config/release.json names the kind wheel, which kit builds as a pure Python wheel from the archive of the directory alone, and its build backend is maturin`), []);
  // The wheel of packages/python is the platform wheel of release-wheel, whose manifest carries the version.
  assert.match(read('packages/python/pyproject.toml'), /^build-backend = "maturin"$/m);
  assert.equal(config.manifests['packages/python/pyproject.toml'], 'version', 'config/release.json does not list packages/python/pyproject.toml as a manifest that carries the version');
  assert.ok(started('ci-assets-platform').includes('release-assets-platform'), 'make ci-assets-platform does not run release-assets-platform');
  const build = dryRun('release-assets-platform').join('\n');
  assert.match(build, /\/mise\/shims\/uv build --wheel .* packages\/python$/m, build);
});
