#!/usr/bin/env node
// Verifies the platform zips of a PHP extension that PIE downloaded (HR-80, H35.51). `pie build` of a php-ext package
// takes the platform zip php_<extension>-v<version>_php<minor>-<platform>.zip of the GitHub Release, whose Composer
// repository names no shasum, so config/php-ext-pins.json pins the sha256 of each zip from the digest of its release
// asset. Composer, inside PIE, downloads the zip into its cache as files/<package>/<sha1 of the URL>.zip and extracts it;
// the recipes set COMPOSER_CACHE_DIR to WORK/cache, so every zip of a run is under WORK/cache/files/<package>. The script
// fails unless that directory holds at least one zip and each is the zip of a pinned PHP minor and platform with the
// pinned sha256.
//
// Usage: node scripts/php-ext-verify.mts PINS PACKAGE WORK
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Pin {
  repository: string;
  version: string;
  extension: string;
  zips: Record<string, Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The pin of `name` in the pin file `file`; a missing or malformed entry throws with the file and the package. */
export function readPin(file: string, name: string): Pin {
  const pins: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const entry = isRecord(pins) && isRecord(pins.packages) ? pins.packages[name] : undefined;
  if (!isRecord(entry) || typeof entry.version !== 'string' || typeof entry.extension !== 'string' || typeof entry.repository !== 'string' || !isRecord(entry.zips)) {
    throw new Error(`${file}: no pin of ${name} with repository, version, extension and zips`);
  }
  const zips: Record<string, Record<string, string>> = {};
  for (const [minor, platforms] of Object.entries(entry.zips)) {
    if (!isRecord(platforms)) throw new Error(`${file}: ${name} zips ${minor} is not an object`);
    zips[minor] = {};
    for (const [platform, sha256] of Object.entries(platforms)) {
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${file}: ${name} ${minor} ${platform} has no sha256`);
      zips[minor][platform] = sha256;
    }
  }
  return { repository: entry.repository, version: entry.version, extension: entry.extension, zips };
}

/** The URL of the release asset of `pin` for the PHP minor `minor` and the platform `platform`. */
export const zipUrl = (pin: Pin, minor: string, platform: string): string =>
  `https://github.com/${pin.repository}/releases/download/v${pin.version}/php_${pin.extension}-v${pin.version}_php${minor}-${platform}.zip`;

/** The file name that the Composer cache gives the download of `url`: the sha1 of the URL. */
export const cacheName = (url: string): string => `${createHash('sha1').update(url).digest('hex')}.zip`;

/** The directory of the Composer cache under `work` that holds the downloads of the package `name`. */
export const cacheDirectory = (work: string, name: string): string => path.join(work, 'cache', 'files', ...name.split('/'));

/** The problems of the zips of the package `name` with the pin `pin` under `work`: none when at least one zip is found and each matches its pin. */
export function verify(name: string, pin: Pin, work: string): string[] {
  const directory = cacheDirectory(work, name);
  const files = existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith('.zip')) : [];
  if (files.length === 0) return [`no zip under ${directory}; PIE downloaded none, so nothing was verified`];
  const pinned = new Map<string, { url: string; sha256: string }>();
  for (const [minor, platforms] of Object.entries(pin.zips)) {
    for (const [platform, sha256] of Object.entries(platforms)) {
      const url = zipUrl(pin, minor, platform);
      pinned.set(cacheName(url), { url, sha256 });
    }
  }
  const problems: string[] = [];
  for (const file of files) {
    const full = path.join(directory, file);
    const expected = pinned.get(file);
    if (expected === undefined) {
      problems.push(`${full}: the download of no pinned zip of ${name} ${pin.version}`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (actual !== expected.sha256) problems.push(`${full} (${expected.url}): sha256 ${actual}, expected ${expected.sha256}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pins, name, work, ...rest] = process.argv.slice(2);
  if (pins === undefined || name === undefined || work === undefined || rest.length > 0) {
    process.stderr.write('Usage: node scripts/php-ext-verify.mts PINS PACKAGE WORK\n');
    process.exit(2);
  }
  let problems: string[];
  try {
    problems = verify(name, readPin(pins, name), work);
  } catch (error) {
    process.stderr.write(`php-ext-verify: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  for (const problem of problems) process.stderr.write(`php-ext-verify: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  const count = readdirSync(cacheDirectory(work, name)).filter((file) => file.endsWith('.zip')).length;
  process.stdout.write(`php-ext-verify: ${count} zip of ${name} under ${cacheDirectory(work, name)} match config/php-ext-pins.json\n`);
}
