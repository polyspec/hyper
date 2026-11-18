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
import { isJsonObject, jsonArray, jsonObject, jsonObjects, type JsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

// The JSON object of the tracked file `file`.
const readObject = (file: string): JsonObject => parseJsonObject(read(file), file);

interface ReleasePackage { kind: string; directory: string; name: string; runtime: string }

const release = readObject('config/release.json');
const config: { packages: ReleasePackage[]; manifests: JsonObject } = {
  packages: jsonObjects(release.packages, 'config/release.json packages').map((item, index) => {
    const where = `config/release.json packages[${index}]`;
    return { kind: jsonString(item.kind, `${where} kind`), directory: jsonString(item.directory, `${where} directory`), name: jsonString(item.name, `${where} name`), runtime: jsonString(item.runtime, `${where} runtime`) };
  }),
  manifests: jsonObject(release.manifests, 'config/release.json manifests'),
};

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
  // release-wheel of binding 0.0.21 builds the wheel with the maturin of mise.toml from the manifest of packages/python.
  assert.match(build, /\/mise\/shims\/maturin build --release .*--manifest-path packages\/python\/Cargo\.toml /m, build);
});

test('H35.35-3 no npm package of kit packs a native file of the checkout, and the jobs platform and npm build the Node package', () => {
  // `npm pack` of kit packs the files of the checkout that `files` names. An addon or a WASM module there is what the
  // checkout happens to hold: the debug addon of the runner that make node-addon builds, and no module of another platform.
  const native = config.packages.filter((item) => item.kind === 'npm').flatMap((item) => {
    const where = `${item.directory}/package.json`;
    const listed = readObject(where).files;
    const files = listed === undefined ? [] : jsonArray(listed, `${where} files`).map((file, index) => jsonString(file, `${where} files[${index}]`));
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
  const development = readObject('package.json').devDependencies;
  const pin = isJsonObject(development) ? development['@napi-rs/cli'] : undefined;
  const napi = typeof pin === 'string' ? pin : undefined;
  assert.ok(napi !== undefined, 'package.json holds no devDependency @napi-rs/cli');
  assert.match(napi ?? '', /^\d+\.\d+\.\d+$/, `package.json pins no @napi-rs/cli, whose bin make release-npm-platform starts: ${napi}`);
});

test('H35.35-4 the job php builds the extension for each PHP minor of config/toolchain.json on each platform, and kit packs its Composer package', () => {
  // release-platform-assets requires one extension archive for each platform and each minor of phpExtension.minors.
  const extension = readObject('config/toolchain.json').phpExtension;
  const minors = isJsonObject(extension) ? extension.minors : undefined;
  assert.ok(Array.isArray(minors) && minors.length > 0 && minors.every((minor) => typeof minor === 'string' && /^\d+\.\d+$/.test(minor)), `config/toolchain.json names no PHP minor of the extension in phpExtension.minors: ${JSON.stringify(minors)}`);
  assert.ok(minors.includes(read('.php-version').trim()), `phpExtension.minors lacks the PHP of .php-version: ${minors.join(' ')}`);
  // The matrix of the job php of assets.yml: one entry for each platform and each minor, and no other.
  const php = /^ {2}php:\n((?: {4}.*\n|\n)*)/m.exec(read('.github/workflows/assets.yml'))?.[1] ?? '';
  const entries = [...php.matchAll(/^ {10}- platform: (\S+)\n {12}runner: \S+\n {12}php: '([^']+)'$/gm)].map((entry) => `${entry[1]} ${entry[2]}`);
  const wanted = ['linux-x64-gnu', 'linux-arm64-gnu', 'darwin-arm64'].flatMap((platform) => minors.map((minor) => `${platform} ${String(minor)}`));
  assert.deepEqual([...entries].sort(), [...wanted].sort(), 'the matrix of the job php of assets.yml is not each platform with each minor of phpExtension.minors');
  assert.ok(started('ci-assets-php', ['EXPECTED_PHP_MINOR=8.4']).includes('release-assets-php'), 'make ci-assets-php does not run release-assets-php');
  assert.match(dryRun('release-assets-php', { variables: ['EXPECTED_PHP_MINOR=8.4'] }).join('\n'), / release-php-ext PHP=php EXPECTED_PHP_MINOR=8\.4$/m);
  // The Composer package of the extension is the package of the crate that release-php-ext builds: kit packs its source
  // zip and names it in packages.json, from which PIE finds the archive of a platform.
  const extensions = config.packages.filter((item) => item.kind === 'composer').filter((item) => readObject(`${item.directory}/composer.json`).type === 'php-ext');
  assert.deepEqual(extensions.map((item) => [item.directory, item.runtime]), [['packages/php/native', 'php-ext']], 'config/release.json names no Composer package of the PHP extension of packages/php/native');
  const [native] = extensions;
  assert.ok(native !== undefined);
  assert.equal(readObject('packages/php/native/composer.json').name, native.name);
  assert.equal(config.manifests['packages/php/native/composer.json'], 'archive');
});

/** The version that the manifest `file` states, or undefined: `version` of a JSON manifest, and of [package] or [project] of a TOML one. */
function manifestVersion(file: string): string | undefined {
  const text = read(file);
  if (file.endsWith('.json')) {
    const { version } = parseJsonObject(text, file);
    return version === undefined ? undefined : jsonString(version, `version of ${file}`);
  }
  return /^\[(?:package|project)\]\n(?:(?!\[).*\n)*?version = "([^"]+)"$/m.exec(text)?.[1];
}

test('H35.35-6 every manifest of config/release.json that states a version states the version of the released packages', () => {
  // The version of a release is the first section ## X.Y.Z of CHANGELOG.md, which package.json carries between
  // releases too. release-php-ext names the archive of the extension by the version of its crate, and
  // release-platform-assets requires the name of the version of the tag, so the crates carry that version as the
  // package manifests do.
  const released = /^## (\d+\.\d+\.\d+)$/m.exec(read('CHANGELOG.md'))?.[1];
  assert.equal(manifestVersion('package.json'), released, 'package.json does not state the version of the first section ## X.Y.Z of CHANGELOG.md');
  const crates = Object.keys(config.manifests).filter((file) => file.endsWith('Cargo.toml'));
  assert.ok(crates.includes('packages/rust/Cargo.toml') && crates.includes('packages/php/native/Cargo.toml'), `config/release.json lists the Cargo.toml of the core and of the PHP extension as manifests: ${crates.join(' ')}`);
  for (const crate of crates) assert.ok(manifestVersion(crate) !== undefined, `${crate} states no version`);
  const other = Object.keys(config.manifests).map((file) => [file, manifestVersion(file)] as const).filter(([, version]) => version !== undefined && version !== released);
  assert.deepEqual(other.map(([file, version]) => `${file} states the version ${String(version)}, and the released packages state ${String(released)}`), []);
});
