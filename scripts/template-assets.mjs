#!/usr/bin/env node
// The release assets of the template tag that config/template-assets.json pins, each with the sha256 of the asset (H14.1-7,
// H23.11):
//
//   node scripts/template-assets.mjs fetch             download each asset, verify its sha256, unpack the php-ext asset into
//                                                      var/products/template-ext and put the php zip alone into the Composer
//                                                      artifact repository var/products/template-php
//   node scripts/template-assets.mjs build <library>   build the unpacked php-ext sources with phpize, configure and make into <library>
//
// `fetch` downloads, so `make install` runs it through $(ONLINE) before Composer reads the artifact repository; `build` reads
// only the unpacked asset and the PHP of PATH, so `make ext` runs offline. The assets have the names that the kit scheme gives
// them (polyspec-template-php-ext-php-<version>.zip, polyspec-template-php-<version>.zip); no step needs a file of the
// template repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config/template-assets.json');
const PRODUCTS = path.join(ROOT, 'var/products');
const DIR = path.join(PRODUCTS, 'template-ext');
const ARTIFACTS = path.join(PRODUCTS, 'template-php');
const MARKER = path.join(DIR, '.sha256');
const USAGE = 'usage: node scripts/template-assets.mjs fetch | build <library>';
const KINDS = ['php-ext', 'php'];

/** The pinned assets of config/template-assets.json by kind; fails with the fix when the file does not name them. */
export function pinned(config = JSON.parse(readFileSync(CONFIG, 'utf8'))) {
  const assets = config.assets ?? {};
  const valid = config.schema === 1 && /^v\d+\.\d+\.\d+$/.test(config.tag ?? '') && Object.keys(assets).sort().join() === [...KINDS].sort().join()
    && KINDS.every((kind) => /^[\w.-]+\.zip$/.test(assets[kind]?.name ?? '') && /^[0-9a-f]{64}$/.test(assets[kind]?.sha256 ?? ''));
  if (!valid) {
    throw new Error(`${path.relative(ROOT, CONFIG)} must name schema 1, a tag vX.Y.Z and, for each of ${KINDS.join(' and ')}, the zip name and the sha256 of the asset; it names ${JSON.stringify(config)}`);
  }
  return Object.fromEntries(KINDS.map((kind) => {
    const { name, sha256 } = assets[kind];
    return [kind, { name, sha256, url: `https://github.com/polyspec/template/releases/download/${config.tag}/${name}`, zip: path.join(PRODUCTS, name) }];
  }));
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The verified bytes of `asset`: the downloaded zip in var/products when its sha256 is the pin, else a new download. */
async function verifiedZip(asset) {
  if (existsSync(asset.zip)) {
    const bytes = readFileSync(asset.zip);
    if (sha256(bytes) === asset.sha256) return bytes;
  }
  console.log(`template-assets: downloading ${asset.url}`);
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`download of ${asset.url} failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== asset.sha256) throw new Error(`${asset.name} has the sha256 ${actual}, expected the pinned ${asset.sha256}; config/template-assets.json names the digest of the release asset`);
  mkdirSync(PRODUCTS, { recursive: true });
  const next = `${asset.zip}.next-${process.pid}`;
  writeFileSync(next, bytes);
  renameSync(next, asset.zip);
  return bytes;
}

/** Replaces `target` with the directory that `fill` writes, staged beside it, so a reader never sees a partial tree. */
function publishDirectory(target, fill) {
  const staging = `${target}.next-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  fill(staging);
  const old = `${target}.old-${process.pid}`;
  if (existsSync(target)) renameSync(target, old);
  renameSync(staging, target);
  rmSync(old, { recursive: true, force: true });
}

/** Unpacks the php-ext asset into var/products/template-ext and records its digest; a current unpacked asset is kept. */
async function fetchExtension(asset) {
  if (existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === asset.sha256) {
    console.log(`template-assets: ${path.relative(ROOT, DIR)} holds the asset ${asset.name}, sha256 ${asset.sha256}`);
    return;
  }
  await verifiedZip(asset);
  publishDirectory(DIR, (staging) => {
    execFileSync('unzip', ['-q', asset.zip, '-d', staging], { stdio: 'inherit' });
    writeFileSync(path.join(staging, '.sha256'), `${asset.sha256}\n`);
  });
  console.log(`template-assets: unpacked ${asset.name} into ${path.relative(ROOT, DIR)}`);
}

/** Puts the verified php zip alone into the artifact repository var/products/template-php, which Composer reads. */
async function fetchComposerZip(asset) {
  const target = path.join(ARTIFACTS, asset.name);
  if (existsSync(target) && readdirSync(ARTIFACTS).join() === asset.name && sha256(readFileSync(target)) === asset.sha256) {
    console.log(`template-assets: ${path.relative(ROOT, ARTIFACTS)} holds the asset ${asset.name}, sha256 ${asset.sha256}`);
    return;
  }
  const bytes = await verifiedZip(asset);
  publishDirectory(ARTIFACTS, (staging) => writeFileSync(path.join(staging, asset.name), bytes));
  console.log(`template-assets: ${path.relative(ROOT, ARTIFACTS)} holds ${asset.name}`);
}

/** Fetches every pinned asset. */
export async function fetchAssets(assets = pinned()) {
  await fetchExtension(assets['php-ext']);
  await fetchComposerZip(assets.php);
}

// The sources that the build reads: the C files, the headers, config.m4 and the stub.
const sourceNames = (source) => readdirSync(source).filter((name) => /\.(c|h)$/.test(name) || name === 'config.m4' || name.endsWith('.stub.php')).sort();

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${[command, ...args].join(' ')} failed with ${result.error?.message ?? `exit ${result.status}`}`);
}

const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

/** Builds the unpacked asset into `library` when its sources or the PHP build changed, publishing it with a rename. */
export function buildExtension(library) {
  const marker = path.join(DIR, '.sha256');
  if (!existsSync(marker)) throw new Error(`${path.relative(ROOT, DIR)} holds no unpacked asset; run make install, which fetches ${pinned()['php-ext'].name}`);
  const source = path.join(DIR, 'src');
  const php = capture('php', ['-r', 'echo PHP_VERSION;']);
  const config = capture('php-config', ['--version']);
  if (php !== config) throw new Error(`php-config of PATH is PHP ${config}, but php of PATH is PHP ${php}; the tests load the extension into php, so both must be one PHP`);
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ php, config: capture('php-config', ['--configure-options']), asset: readFileSync(marker, 'utf8') }));
  for (const name of sourceNames(source)) {
    hash.update(`\0${name}\0`);
    hash.update(readFileSync(path.join(source, name)));
  }
  const digest = hash.digest('hex');
  const stamp = `${library}.inputs.json`;
  if (existsSync(library) && existsSync(stamp) && JSON.parse(readFileSync(stamp, 'utf8')).hash === digest) {
    console.log(`template-assets: ${library} is current for PHP ${php}`);
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-template-ext-'));
  try {
    for (const name of sourceNames(source)) copyFileSync(path.join(source, name), path.join(directory, name));
    run('phpize', [], { cwd: directory });
    run('./configure', ['--with-php-config=php-config'], { cwd: directory });
    run('make', [], { cwd: directory });
    const name = /PHP_NEW_EXTENSION\(\[?(\w+)/.exec(readFileSync(path.join(source, 'config.m4'), 'utf8'))?.[1];
    if (!name) throw new Error(`${path.join(source, 'config.m4')} declares no PHP_NEW_EXTENSION`);
    mkdirSync(path.dirname(library), { recursive: true });
    const next = `${library}.next-${process.pid}`;
    copyFileSync(path.join(directory, 'modules', `${name}.so`), next);
    renameSync(next, library);
    writeFileSync(stamp, `${JSON.stringify({ hash: digest, php }, null, 2)}\n`);
    console.log(`template-assets: ${library} now holds the build of ${pinned()['php-ext'].name} for PHP ${php}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, library] = process.argv.slice(2);
  try {
    if (command === 'fetch' && process.argv.length === 3) await fetchAssets();
    else if (command === 'build' && library) buildExtension(path.resolve(library));
    else { console.error(USAGE); process.exit(2); }
  } catch (error) {
    console.error(`template-assets: ${error.message}`);
    process.exit(1);
  }
}
