#!/usr/bin/env node
// Verifies the platform zips of a PHP extension that PIE downloaded (HR-80, H35.51). `pie build` of a php-ext package takes
// the platform zip php_<extension>-v<version>_php<minor>-<platform>.zip of the GitHub Release, whose Composer repository
// names no shasum, so config/php-ext-pins.json pins the sha256 of each zip from the digest of its release asset. The
// script finds every zip of the extension under WORK, the PIE_WORKING_DIRECTORY of the recipe, and fails unless there is at
// least one and each has the pinned version, a pinned PHP minor and platform, and the pinned sha256.
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

/** The file name of the release asset of `pin` for the PHP minor `minor` and the platform `platform`. */
export const zipName = (pin: Pin, minor: string, platform: string): string => `php_${pin.extension}-v${pin.version}_php${minor}-${platform}.zip`;

// Every file under `directory` whose name starts with `prefix` and ends with .zip.
function zipsUnder(directory: string, prefix: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...zipsUnder(file, prefix));
    else if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.zip')) found.push(file);
  }
  return found;
}

/** The problems of the zips of `pin` under `work`: none when at least one zip is found and each matches its pin. */
export function verify(pin: Pin, work: string): string[] {
  const zips = zipsUnder(work, `php_${pin.extension}-`);
  if (zips.length === 0) return [`no zip php_${pin.extension}-*.zip under ${work}; PIE downloaded none, so nothing was verified`];
  const problems: string[] = [];
  for (const file of zips) {
    const name = path.basename(file);
    const match = /^php_.+-v(\d+\.\d+\.\d+)_php(\d+\.\d+)-(.+)\.zip$/.exec(name);
    const [, version, minor, platform] = match ?? [];
    if (version === undefined || minor === undefined || platform === undefined) {
      problems.push(`${file}: the name is not php_${pin.extension}-v<version>_php<minor>-<platform>.zip`);
      continue;
    }
    if (version !== pin.version) {
      problems.push(`${file}: version ${version}, expected ${pin.version}`);
      continue;
    }
    const expected = pin.zips[minor]?.[platform];
    if (expected === undefined) {
      problems.push(`${file}: no pinned sha256 for PHP ${minor} on ${platform}`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== expected) problems.push(`${file}: sha256 ${actual}, expected ${expected}`);
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
    problems = verify(readPin(pins, name), work);
  } catch (error) {
    process.stderr.write(`php-ext-verify: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  for (const problem of problems) process.stderr.write(`php-ext-verify: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
}
