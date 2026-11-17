#!/usr/bin/env node
// Writes config/php-ext-pins.json (HR-80, H35.58): for each package that the file pins, the script reads the assets of
// the GitHub Release v<version> of its repository through the releases API, downloads the asset packages.json and each
// platform zip php_<extension>-v<version>_php<minor>-<platform>.zip, and fails, naming the asset, its digest and the
// sha256 of the download, unless each download has the sha256 of the field digest of its asset. Only then does it write
// the file with one rename (HR-82): the version, the repository and the extension of each package stay as the file has
// them, and the sha256 of packages.json and of every platform zip come from the release. The make target php-ext-pins
// runs it under $(ONLINE); no check runs it (HR-89).
//
// Usage: node scripts/php-ext-pins.mts write PINS
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';

/** An asset of a GitHub Release: its name, its field digest `sha256:<hex>` and its download URL. */
export interface ReleaseAsset {
  name: string;
  digest: string;
  url: string;
}

/** The fields of a pin that the file states and the release does not. */
export interface PinSource {
  repository: string;
  version: string;
  extension: string;
}

/** The pin of a package as config/php-ext-pins.json holds it. */
export interface Pin extends PinSource {
  packages: string;
  zips: Record<string, Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The hex sha256 of the field digest of `asset`; a digest of another form throws. */
function digestOf(asset: ReleaseAsset): string {
  const match = /^sha256:([0-9a-f]{64})$/u.exec(asset.digest);
  if (match?.[1] === undefined) throw new Error(`${asset.name}: the release gives no sha256 digest (${asset.digest})`);
  return match[1];
}

/** The pin of `source` from the assets of its release: the digest of packages.json and of each platform zip. */
export function pinFromRelease(source: PinSource, assets: ReleaseAsset[]): Pin {
  const packages = assets.find((asset) => asset.name === 'packages.json');
  if (packages === undefined) throw new Error(`${source.repository} v${source.version}: the release has no packages.json`);
  const zip = new RegExp(`^php_${escape(source.extension)}-v${escape(source.version)}_php(\\d+\\.\\d+)-(.+)\\.zip$`, 'u');
  const zips: Record<string, Record<string, string>> = {};
  for (const asset of [...assets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const match = zip.exec(asset.name);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    zips[match[1]] = { ...zips[match[1]], [match[2]]: digestOf(asset) };
  }
  if (Object.keys(zips).length === 0) throw new Error(`${source.repository} v${source.version}: the release has no platform zip of ${source.extension}`);
  return { repository: source.repository, version: source.version, packages: digestOf(packages), extension: source.extension, zips };
}

/** The problems of the downloads `files`, by asset name, against the digests of `assets`: one for each mismatch or missing file. */
export function downloadProblems(assets: ReleaseAsset[], files: Map<string, Uint8Array>): string[] {
  const problems: string[] = [];
  for (const asset of assets) {
    const bytes = files.get(asset.name);
    if (bytes === undefined) {
      problems.push(`${asset.name}: not downloaded`);
      continue;
    }
    const expected = digestOf(asset);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) problems.push(`${asset.name}: the release digest is ${expected}, the download has sha256 ${actual}`);
  }
  return problems;
}

/** The assets of the release v`version` of `repository`, read from the GitHub releases API. */
async function releaseAssets(repository: string, version: string): Promise<ReleaseAsset[]> {
  const url = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const release: unknown = await response.json();
  const assets = isRecord(release) && Array.isArray(release.assets) ? release.assets : [];
  return assets.flatMap((asset: unknown) =>
    isRecord(asset) && typeof asset.name === 'string' && typeof asset.digest === 'string' && typeof asset.browser_download_url === 'string'
      ? [{ name: asset.name, digest: asset.digest, url: asset.browser_download_url }]
      : [],
  );
}

/** Downloads `asset`. */
async function download(asset: ReleaseAsset): Promise<Uint8Array> {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Writes the pin file `file` from the releases of the packages that it pins. */
async function write(file: string): Promise<void> {
  const pins: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isRecord(pins) || !isRecord(pins.packages)) throw new Error(`${file}: no member packages`);
  const packages: Record<string, Pin> = {};
  for (const [name, entry] of Object.entries(pins.packages)) {
    if (!isRecord(entry) || typeof entry.repository !== 'string' || typeof entry.version !== 'string' || typeof entry.extension !== 'string') {
      throw new Error(`${file}: ${name} names no repository, version and extension`);
    }
    const source = { repository: entry.repository, version: entry.version, extension: entry.extension };
    const assets = await releaseAssets(source.repository, source.version);
    const pin = pinFromRelease(source, assets);
    const pinned = assets.filter((asset) => asset.name === 'packages.json' || asset.name.startsWith(`php_${source.extension}-v${source.version}_php`));
    const files = new Map<string, Uint8Array>();
    for (const asset of pinned) {
      process.stdout.write(`php-ext-pins: ${name}: downloading ${asset.name}\n`);
      files.set(asset.name, await download(asset));
    }
    const problems = downloadProblems(pinned, files);
    if (problems.length > 0) throw new Error(`${name} v${source.version}:\n  ${problems.join('\n  ')}`);
    packages[name] = pin;
  }
  writeFileAtomic(file, `${JSON.stringify({ ...pins, packages }, null, 2)}\n`);
  process.stdout.write(`php-ext-pins: wrote ${file} for ${Object.keys(packages).join(', ')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  if (mode !== 'write' || file === undefined) {
    process.stderr.write('Usage: node scripts/php-ext-pins.mts write PINS\n');
    process.exit(2);
  }
  write(file).catch((error: unknown) => {
    process.stderr.write(`php-ext-pins: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
