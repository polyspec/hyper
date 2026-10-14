#!/usr/bin/env node
// The release assets of the template tag that config/template-assets.json pins, each as { url, sha256, destination }
// (H14.1-7, H23.11):
//
//   node scripts/template-assets.mts fetch             download each asset that its destination lacks, verify its sha256
//                                                      and write it to its destination; the php zip lands in the Composer
//                                                      artifact repository var/products/template-php
//   node scripts/template-assets.mts unpack            unpack the php-ext asset into var/products/template-ext
//   node scripts/template-assets.mts build <library>   build the unpacked php-ext sources with phpize, configure and make into <library>
//
// `fetch` downloads, so `make install` runs it through $(ONLINE) before Composer reads the artifact repository; it is the
// generic step that the fetch tool of kit K140 replaces (H23.11-2). `unpack` and `build` read only the files of the checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config/template-assets.json');
const DIR = path.join(ROOT, 'var/products/template-ext');
const MARKER = path.join(DIR, '.sha256');
const EXT_ZIP = /\/polyspec-template-php-ext-php-\d+\.\d+\.\d+\.zip$/;
const USAGE = 'usage: node scripts/template-assets.mts fetch | unpack | build <library>';

/** An entry of config/template-assets.json. */
interface Asset { url: string; sha256: string; destination: string }
/** A pinned asset with the absolute path of its destination. */
interface PinnedAsset extends Asset { file: string }
/** The file config/template-assets.json as JSON.parse reads it, before its check. */
interface Config { schema?: unknown; assets?: unknown }

/** Whether `value` is an entry { url, sha256, destination } with an https URL, a sha256 and a destination under var/. */
function isAsset(value: unknown): value is Asset {
  if (typeof value !== 'object' || value === null) return false;
  const { url, sha256, destination } = value as Record<string, unknown>;
  return typeof url === 'string' && /^https:\/\//.test(url) && typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256)
    && typeof destination === 'string' && /^var\/[\w./-]+$/.test(destination) && !destination.split('/').includes('..');
}

/** The pinned assets of config/template-assets.json; fails with the fix when an entry is not { url, sha256, destination }. */
export function pinned(config: Config = JSON.parse(readFileSync(CONFIG, 'utf8')) as Config): PinnedAsset[] {
  const assets = config.assets;
  if (config.schema !== 1 || !Array.isArray(assets) || !assets.every(isAsset)) {
    throw new Error(`${path.relative(ROOT, CONFIG)} must name schema 1 and assets of { url, sha256, destination under var/ }; it names ${JSON.stringify(config)}`);
  }
  return assets.map((asset) => ({ ...asset, file: path.join(ROOT, asset.destination) }));
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Writes each asset whose destination does not hold its sha256: downloaded, verified, then renamed into place. */
export async function fetchAssets(assets: PinnedAsset[] = pinned()): Promise<void> {
  for (const asset of assets) {
    if (existsSync(asset.file) && sha256(readFileSync(asset.file)) === asset.sha256) {
      console.log(`template-assets: ${asset.destination} holds sha256 ${asset.sha256}`);
      continue;
    }
    console.log(`template-assets: downloading ${asset.url}`);
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`download of ${asset.url} failed with HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== asset.sha256) throw new Error(`${asset.url} has the sha256 ${actual}, expected the pinned ${asset.sha256} of config/template-assets.json`);
    mkdirSync(path.dirname(asset.file), { recursive: true });
    const next = `${asset.file}.next-${process.pid}`;
    writeFileSync(next, bytes);
    renameSync(next, asset.file);
    console.log(`template-assets: wrote ${asset.destination}`);
  }
}

/** The pinned php-ext asset; fails when config/template-assets.json names none or more than one. */
function extensionAsset(assets: PinnedAsset[] = pinned()): PinnedAsset {
  const [asset, ...others] = assets.filter((candidate) => EXT_ZIP.test(candidate.url));
  if (asset === undefined || others.length > 0) throw new Error(`config/template-assets.json names ${asset === undefined ? 0 : others.length + 1} php-ext assets; it must name one`);
  return asset;
}

/** Unpacks the fetched php-ext asset into var/products/template-ext through a staging directory; a current tree is kept. */
export function unpackExtension(asset: PinnedAsset = extensionAsset()): void {
  if (existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === asset.sha256) {
    console.log(`template-assets: ${path.relative(ROOT, DIR)} holds the asset of sha256 ${asset.sha256}`);
    return;
  }
  if (!existsSync(asset.file) || sha256(readFileSync(asset.file)) !== asset.sha256) throw new Error(`${asset.destination} does not hold the pinned asset; run make install, which fetches it`);
  const staging = `${DIR}.next-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  execFileSync('unzip', ['-q', asset.file, '-d', staging], { stdio: 'inherit' });
  writeFileSync(path.join(staging, '.sha256'), `${asset.sha256}\n`);
  const old = `${DIR}.old-${process.pid}`;
  if (existsSync(DIR)) renameSync(DIR, old);
  renameSync(staging, DIR);
  rmSync(old, { recursive: true, force: true });
  console.log(`template-assets: unpacked ${asset.destination} into ${path.relative(ROOT, DIR)}`);
}

// The sources that the build reads: the C files, the headers, config.m4 and the stub.
const sourceNames = (source: string): string[] => readdirSync(source).filter((name) => /\.(c|h)$/.test(name) || name === 'config.m4' || name.endsWith('.stub.php')).sort();

function run(command: string, args: string[], options: { cwd: string }): void {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${[command, ...args].join(' ')} failed with ${result.error?.message ?? `exit ${result.status}`}`);
}

const capture = (command: string, args: string[]): string => execFileSync(command, args, { encoding: 'utf8' }).trim();

/** Builds the unpacked asset into `library` when its sources or the PHP build changed, publishing it with a rename. */
export function buildExtension(library: string): void {
  const marker = path.join(DIR, '.sha256');
  if (!existsSync(marker)) throw new Error(`${path.relative(ROOT, DIR)} holds no unpacked asset; run make install, which fetches and unpacks ${extensionAsset().destination}`);
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
  if (existsSync(library) && existsSync(stamp) && (JSON.parse(readFileSync(stamp, 'utf8')) as { hash?: unknown }).hash === digest) {
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
    console.log(`template-assets: ${library} now holds the build of ${extensionAsset().destination} for PHP ${php}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, library] = process.argv.slice(2);
  try {
    if (command === 'fetch' && process.argv.length === 3) await fetchAssets();
    else if (command === 'unpack' && process.argv.length === 3) unpackExtension();
    else if (command === 'build' && library) buildExtension(path.resolve(library));
    else { console.error(USAGE); process.exit(2); }
  } catch (error) {
    console.error(`template-assets: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
