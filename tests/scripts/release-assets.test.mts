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

test('H35.35-3 no npm package of kit packs a native file of the checkout, and the jobs platform and npm build the Node package', () => {
  // `npm pack` of kit packs the files of the checkout that `files` names. An addon or a WASM module there is what the
  // checkout happens to hold: the debug addon of the runner that make node-addon builds, and no module of another platform.
  const native = config.packages.filter((item) => item.kind === 'npm').flatMap((item) => {
    const files = (JSON.parse(read(`${item.directory}/package.json`)) as { files?: string[] }).files ?? [];
    return files.filter((file) => /\.(?:node|wasm)$/.test(file)).map((file) => `${item.directory}: config/release.json names an npm package of kit, and its files hold ${file}, a native file that npm pack takes from the checkout`);
  });
  assert.deepEqual(native, []);
  // @polyspec/hyper is packed by release-npm with its WASM module, and its addon by release-npm-platform for each
  // platform; its manifest carries the version.
  assert.equal(config.manifests['packages/ts/package.json'], 'version', 'config/release.json does not list packages/ts/package.json as a manifest that carries the version');
  assert.ok(started('ci-assets-npm').includes('release-assets-npm'), 'make ci-assets-npm does not run release-assets-npm');
  assert.ok(!started('ci-assets-npm').includes('node-addon'), 'make ci-assets-npm builds the addon of the runner into the folder that release-npm packs');
  const npm = dryRun('release-assets-npm').join('\n');
  assert.match(npm, /-p polyspec-hyper-wasm --target wasm32-unknown-unknown\b/, npm);
  const platform = dryRun('release-assets-platform').join('\n');
  // The napi CLI that release-npm-platform starts is the bin of a devDependency, pinned by its exact version (HR-70).
  assert.match(platform, /\/node_modules\/\.bin\/napi build --platform --release /, platform);
  const napi = (JSON.parse(read('package.json')) as { devDependencies?: Record<string, string> }).devDependencies?.['@napi-rs/cli'];
  assert.match(napi ?? '', /^\d+\.\d+\.\d+$/, `package.json pins no @napi-rs/cli, whose bin make release-npm-platform starts: ${napi}`);
});
