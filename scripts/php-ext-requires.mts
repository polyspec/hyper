#!/usr/bin/env node
// Checks that the PHP extension package PACKAGE at VERSION of the Composer repository PACKAGES requires the json release
// JSON_VERSION that json-ext installs (H35.52). A template package requires the Composer library polyspec/json at an exact
// version and the extension ext-polyspec_json; PHP loads one json library, so a template that requires another json
// version than JSON_VERSION would run against a json extension of another release. The check fails naming both versions.
// PACKAGES is the URL of the packages.json of the release, which `make template-ext` reads under $(ONLINE) before PIE,
// or a file of a test.
//
// Usage: node scripts/php-ext-requires.mts PACKAGES PACKAGE VERSION JSON_VERSION
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

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

async function read(source: string): Promise<unknown> {
  if (!/^https:\/\//.test(source)) return JSON.parse(readFileSync(source, 'utf8'));
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [packages, name, version, jsonVersion, ...rest] = process.argv.slice(2);
  if (packages === undefined || name === undefined || version === undefined || jsonVersion === undefined || rest.length > 0) {
    process.stderr.write('Usage: node scripts/php-ext-requires.mts PACKAGES PACKAGE VERSION JSON_VERSION\n');
    process.exit(2);
  }
  let problems: string[];
  try {
    problems = jsonProblems(await read(packages), name, version, jsonVersion);
  } catch (error) {
    process.stderr.write(`php-ext-requires: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  for (const problem of problems) process.stderr.write(`php-ext-requires: ${packages}: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`php-ext-requires: ${name} ${version} requires polyspec/json ${jsonVersion}, the version of json-ext\n`);
}
