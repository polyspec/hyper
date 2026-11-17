#!/usr/bin/env node
// Downloads and verifies the Composer repository (packages.json) of the release of each PHP extension package that PIE
// reads, and checks the json version that the template package requires (HR-80, H35.52, H35.54).
//
// config/php-ext-pins.json pins, for each package, the sha256 of the release asset packages.json from its field digest.
// The script downloads that asset into WORK/repository/<package>/packages.json, fails naming the file, the expected and the
// actual sha256 when they differ, and only then reads it; the recipes give PIE that verified copy as its repository, not the
// URL, so PIE resolves no file that nothing verified. The trap of the recipe removes WORK with the copy.
//
// With REQUIRED, the packages.json of REQUIRED is downloaded and verified as well, and PACKAGE at its pinned version must
// require the Composer library REQUIRED at the pinned version of REQUIRED: a template package requires polyspec/json at an
// exact version and ext-polyspec_json, and PHP loads one json library, so a template that requires another json version
// than the one json-ext installs would run against a json extension of another release.
//
// Usage: node scripts/php-ext-requires.mts PINS PACKAGE WORK [REQUIRED]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPin, type Pin } from './php-ext-verify.mts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The URL of the release asset packages.json of `pin`. */
export const packagesUrl = (pin: Pin): string => `https://github.com/${pin.repository}/releases/download/v${pin.version}/packages.json`;

/** The path of the verified copy of the packages.json of the package `name` under `work`, which PIE adds as its repository. */
export const packagesPath = (work: string, name: string): string => path.join(work, 'repository', ...name.split('/'), 'packages.json');

/** The pinned sha256 of the packages.json of `name` in the pin file `file`; a missing or malformed pin throws. */
export function readPackagesPin(file: string, name: string): string {
  const pins: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const entry = isRecord(pins) && isRecord(pins.packages) ? pins.packages[name] : undefined;
  const sha256 = isRecord(entry) ? entry.packages : undefined;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${file}: ${name} has no sha256 of its packages.json in packages`);
  return sha256;
}

/** The problem of the packages.json `bytes` written to `file` against the pinned `sha256`, or none. */
export function digestProblem(file: string, bytes: Uint8Array, sha256: string): string | undefined {
  const actual = createHash('sha256').update(bytes).digest('hex');
  return actual === sha256 ? undefined : `${file}: sha256 ${actual}, expected ${sha256}`;
}

/** The problems of the requirements of `name` at `version` in the Composer repository `repository` against `jsonVersion`. */
export function jsonProblems(repository: unknown, name: string, version: string, jsonVersion: string): string[] {
  const versions = isRecord(repository) && isRecord(repository.packages) ? repository.packages[name] : undefined;
  const entry = isRecord(versions) ? (versions[`v${version}`] ?? versions[version]) : undefined;
  if (!isRecord(entry)) return [`the Composer repository has no ${name} ${version}`];
  const require = isRecord(entry.require) ? entry.require : {};
  const problems: string[] = [];
  const library = require['polyspec/json'];
  if (library === undefined) problems.push(`${name} ${version} requires no polyspec/json, so its json version is not known`);
  else if (library !== jsonVersion) problems.push(`${name} ${version} requires polyspec/json ${String(library)}, and json-ext installs ${jsonVersion}`);
  const extension = require['ext-polyspec_json'];
  if (extension !== undefined && extension !== '*' && extension !== jsonVersion) {
    problems.push(`${name} ${version} requires ext-polyspec_json ${String(extension)}, and json-ext installs ${jsonVersion}`);
  }
  return problems;
}

/** Writes the packages.json of `name`, which `source` reads from its URL, into `work`, verifies it against its pin and returns its content; a mismatch throws naming the file, the expected and the actual sha256. */
export async function fetchVerified(pins: string, name: string, work: string, source: (url: string) => Promise<Uint8Array>): Promise<unknown> {
  const pin = readPin(pins, name);
  const sha256 = readPackagesPin(pins, name);
  const url = packagesUrl(pin);
  const file = packagesPath(work, name);
  const bytes = await source(url);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const problem = digestProblem(`${file} (${url})`, bytes, sha256);
  if (problem !== undefined) throw new Error(problem);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

/** Reads `url` over HTTPS. */
async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pins, name, work, required, ...rest] = process.argv.slice(2);
  if (pins === undefined || name === undefined || work === undefined || rest.length > 0) {
    process.stderr.write('Usage: node scripts/php-ext-requires.mts PINS PACKAGE WORK [REQUIRED]\n');
    process.exit(2);
  }
  let problems: string[] = [];
  try {
    const repository = await fetchVerified(pins, name, work, download);
    process.stdout.write(`php-ext-requires: ${packagesPath(work, name)} matches the sha256 of config/php-ext-pins.json\n`);
    if (required !== undefined) {
      await fetchVerified(pins, required, work, download);
      process.stdout.write(`php-ext-requires: ${packagesPath(work, required)} matches the sha256 of config/php-ext-pins.json\n`);
      problems = jsonProblems(repository, name, readPin(pins, name).version, readPin(pins, required).version);
    }
  } catch (error) {
    process.stderr.write(`php-ext-requires: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  for (const problem of problems) process.stderr.write(`php-ext-requires: ${packagesPath(work, name)}: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  if (required !== undefined) process.stdout.write(`php-ext-requires: ${name} requires ${required} ${readPin(pins, required).version}, the version of its pin\n`);
}
