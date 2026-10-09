#!/usr/bin/env node
// The native template extension of this repository (H14.1-7), built from the php-ext release asset of the template tag
// that config/template-ext.json names:
//
//   node scripts/template-ext.mjs fetch             download the asset, verify its sha256 and unpack it into var/products/template-ext
//   node scripts/template-ext.mjs build <library>   build the unpacked sources with phpize, configure and make into <library>
//
// `fetch` downloads, so `make install` runs it through $(ONLINE); `build` reads only the unpacked asset and the PHP of PATH,
// so `make ext` runs offline. The asset is the php-ext package of the template release, the name that the kit scheme gives
// it (polyspec-template-php-ext-php-<version>.zip); the build needs no file of the template repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config/template-ext.json');
const PRODUCTS = path.join(ROOT, 'var/products');
const DIR = path.join(PRODUCTS, 'template-ext');
const MARKER = path.join(DIR, '.sha256');
const USAGE = 'usage: node scripts/template-ext.mjs fetch | build <library>';

/** The pinned asset of config/template-ext.json; fails with the fix when the file does not name one. */
export function pinned(config = JSON.parse(readFileSync(CONFIG, 'utf8'))) {
  if (config.schema !== 1 || !/^v\d+\.\d+\.\d+$/.test(config.tag ?? '') || !/^[0-9a-f]{64}$/.test(config.sha256 ?? '')) {
    throw new Error(`${path.relative(ROOT, CONFIG)} must name schema 1, a tag vX.Y.Z and the sha256 of the asset; it names ${JSON.stringify(config)}`);
  }
  const url = `https://github.com/polyspec/template/releases/download/${config.tag}/${config.asset}`;
  return { ...config, url, zip: path.join(PRODUCTS, config.asset) };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Downloads the asset when it is missing, unpacks it and records its digest; a current unpacked asset is kept. */
export async function fetchAsset(asset = pinned()) {
  if (existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === asset.sha256) {
    console.log(`template-ext: ${path.relative(ROOT, DIR)} holds the asset ${asset.asset}, sha256 ${asset.sha256}`);
    return;
  }
  mkdirSync(PRODUCTS, { recursive: true });
  let bytes;
  if (existsSync(asset.zip)) {
    bytes = readFileSync(asset.zip);
    if (sha256(bytes) !== asset.sha256) bytes = undefined;
  }
  if (!bytes) {
    console.log(`template-ext: downloading ${asset.url}`);
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`download of ${asset.url} failed with HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== asset.sha256) throw new Error(`${asset.asset} has the sha256 ${actual}, expected the pinned ${asset.sha256}; config/template-ext.json names the digest of the release asset`);
    const next = `${asset.zip}.next-${process.pid}`;
    writeFileSync(next, bytes);
    renameSync(next, asset.zip);
  }
  // The unpacked tree is written beside the target and then moved into place, so a reader never sees a partial tree.
  const staging = `${DIR}.next-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  execFileSync('unzip', ['-q', asset.zip, '-d', staging], { stdio: 'inherit' });
  writeFileSync(path.join(staging, '.sha256'), `${asset.sha256}\n`);
  const old = `${DIR}.old-${process.pid}`;
  if (existsSync(DIR)) renameSync(DIR, old);
  renameSync(staging, DIR);
  rmSync(old, { recursive: true, force: true });
  console.log(`template-ext: unpacked ${asset.asset} into ${path.relative(ROOT, DIR)}`);
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
  if (!existsSync(marker)) throw new Error(`${path.relative(ROOT, DIR)} holds no unpacked asset; run make install, which fetches ${pinned().asset}`);
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
    console.log(`template-ext: ${library} is current for PHP ${php}`);
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
    console.log(`template-ext: ${library} now holds the build of ${pinned().asset} for PHP ${php}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, library] = process.argv.slice(2);
  try {
    if (command === 'fetch' && process.argv.length === 3) await fetchAsset();
    else if (command === 'build' && library) buildExtension(path.resolve(library));
    else { console.error(USAGE); process.exit(2); }
  } catch (error) {
    console.error(`template-ext: ${error.message}`);
    process.exit(1);
  }
}
