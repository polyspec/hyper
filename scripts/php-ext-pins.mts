#!/usr/bin/env node
// Writes config/php-ext-pins.json (HR-80, H35.58): for each package that the file pins, the script reads the response of
// releases/tags/v<version> of its repository from the GitHub releases API and writes the sha256 of the asset
// packages.json and of each platform zip php_<extension>-v<version>_php<minor>-<platform>.zip from the field digest of
// the asset; an asset of those files without a sha256 digest stops the script before it writes. The version, the
// repository and the extension of each package stay as the file has them. The script only writes, with one rename
// (HR-82): it downloads no asset, because the install that downloads one verifies it by its pin (scripts/php-ext-verify.mts,
// scripts/php-ext-requires.mts). The make target php-ext-pins runs it under $(ONLINE); no check runs it (HR-89).
// `record` writes into DIR, for each pinned package, <repository name>-v<version>.json with the body of that response as
// it came, each with one rename: the recorded responses that the tests of the writer read (make php-ext-pins-record,
// H35.74-1).
//
// Usage: node scripts/php-ext-pins.mts write PINS
//        node scripts/php-ext-pins.mts record PINS DIR
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';

/** The response of releases/tags/v`version` of `repository`. */
export type ReleaseOf = (repository: string, version: string) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The hex sha256 of the field digest of the asset `name` of `release`; an asset without one throws. */
function digestOf(where: string, name: string, digest: unknown): string {
  const match = typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/u.exec(digest) : null;
  if (match?.[1] === undefined) throw new Error(`${where}: the asset ${name} has no sha256 digest (${JSON.stringify(digest)})`);
  return match[1];
}

/** The pin of one package from the response `release` of its release. */
function pinOf(name: string, entry: Record<string, unknown>, release: unknown): Record<string, unknown> {
  const { repository, version, extension } = entry;
  if (typeof repository !== 'string' || typeof version !== 'string' || typeof extension !== 'string') {
    throw new Error(`${name} names no repository, version and extension`);
  }
  const where = `${repository} v${version}`;
  const assets = isRecord(release) && Array.isArray(release.assets) ? release.assets.filter(isRecord) : [];
  const names = (asset: Record<string, unknown>): string => (typeof asset.name === 'string' ? asset.name : '');
  const packages = assets.find((asset) => names(asset) === 'packages.json');
  if (packages === undefined) throw new Error(`${where}: the release has no packages.json`);
  const zip = new RegExp(`^php_${escape(extension)}-v${escape(version)}_php(\\d+\\.\\d+)-(.+)\\.zip$`, 'u');
  const zips: Record<string, Record<string, string>> = {};
  for (const asset of [...assets].sort((a, b) => byName(names(a), names(b)))) {
    const match = zip.exec(names(asset));
    if (match?.[1] === undefined || match[2] === undefined) continue;
    zips[match[1]] = { ...zips[match[1]], [match[2]]: digestOf(where, names(asset), asset.digest) };
  }
  if (Object.keys(zips).length === 0) throw new Error(`${where}: the release has no platform zip of ${extension}`);
  return { repository, version, packages: digestOf(where, 'packages.json', packages.digest), extension, zips };
}

/** The text of the pin file `text` written again from the release responses that `release` gives. */
export function pinsText(text: string, release: ReleaseOf): string {
  const pins: unknown = JSON.parse(text);
  if (!isRecord(pins) || !isRecord(pins.packages)) throw new Error('the pin file has no member packages');
  const packages: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(pins.packages)) {
    if (!isRecord(entry)) throw new Error(`${name} is no object`);
    packages[name] = pinOf(name, entry, release(String(entry.repository), String(entry.version)));
  }
  return `${JSON.stringify({ ...pins, packages }, null, 2)}\n`;
}

/** The body of the response of releases/tags/v`version` of `repository`, as the releases API sent it. */
export type BodyOf = (repository: string, version: string) => string;

/**
 * The recorded release responses of the packages of the pin file `text` (H35.74-1): for each, the file
 * <repository name>-v<version>.json with the body that `body` gives, kept as it came, which the tests of the writer read.
 * A body that is no release with assets throws before anything is written.
 */
export function recordedFiles(text: string, body: BodyOf): Record<string, string> {
  const pins: unknown = JSON.parse(text);
  if (!isRecord(pins) || !isRecord(pins.packages)) throw new Error('the pin file has no member packages');
  const files: Record<string, string> = {};
  for (const [name, entry] of Object.entries(pins.packages)) {
    if (!isRecord(entry) || typeof entry.repository !== 'string' || typeof entry.version !== 'string') throw new Error(`${name} names no repository and version`);
    const received = body(entry.repository, entry.version);
    const release: unknown = JSON.parse(received);
    if (!isRecord(release) || !Array.isArray(release.assets)) throw new Error(`${entry.repository} v${entry.version}: the response is no release with assets`);
    files[`${entry.repository.split('/').at(-1) ?? entry.repository}-v${entry.version}.json`] = received;
  }
  return files;
}

/** The bodies of the release responses of the packages of `text`, read from the GitHub releases API. */
async function bodies(text: string): Promise<BodyOf> {
  const pins: unknown = JSON.parse(text);
  const entries = isRecord(pins) && isRecord(pins.packages) ? Object.values(pins.packages).filter(isRecord) : [];
  const received = new Map<string, string>();
  for (const entry of entries) {
    const url = `https://api.github.com/repos/${String(entry.repository)}/releases/tags/v${String(entry.version)}`;
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    received.set(`${String(entry.repository)} ${String(entry.version)}`, await response.text());
  }
  return (repository, version) => received.get(`${repository} ${version}`) ?? '';
}

/** Reads the release responses of the packages of `text` from the GitHub releases API. */
async function releases(text: string): Promise<ReleaseOf> {
  const pins: unknown = JSON.parse(text);
  const entries = isRecord(pins) && isRecord(pins.packages) ? Object.values(pins.packages).filter(isRecord) : [];
  const responses = new Map<string, unknown>();
  for (const entry of entries) {
    const key = `${String(entry.repository)} ${String(entry.version)}`;
    const url = `https://api.github.com/repos/${String(entry.repository)}/releases/tags/v${String(entry.version)}`;
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    responses.set(key, await response.json());
  }
  return (repository, version) => responses.get(`${repository} ${version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, file, directory] = process.argv.slice(2);
  if (!((mode === 'write' && file !== undefined && directory === undefined) || (mode === 'record' && file !== undefined && directory !== undefined))) {
    process.stderr.write('Usage: node scripts/php-ext-pins.mts write PINS\n       node scripts/php-ext-pins.mts record PINS DIR\n');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  if (mode === 'record') {
    bodies(text)
      .then((body) => {
        for (const [name, received] of Object.entries(recordedFiles(text, body))) {
          writeFileAtomic(path.join(directory ?? '', name), received);
          process.stdout.write(`php-ext-pins: recorded ${path.join(directory ?? '', name)}\n`);
        }
      })
      .catch((error: unknown) => {
        process.stderr.write(`php-ext-pins: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      });
  } else releases(text)
    .then((release) => {
      writeFileAtomic(file, pinsText(text, release));
      process.stdout.write(`php-ext-pins: wrote ${file}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`php-ext-pins: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
