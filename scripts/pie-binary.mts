#!/usr/bin/env node
// Prints the library that PIE built for the package NAME in the working directory WORK (H27.51). PIE keeps one Composer
// project per target PHP under its PIE_WORKING_DIRECTORY and records a build as the pie-built-binary of the entry of the
// package in <WORK>/<target>/vendor/composer/installed.json, a path relative to that vendor/composer. The recipe of
// template-ext runs PIE in an empty WORK, so exactly one entry of NAME carries a pie-built-binary; any other count fails.
//
// Usage: node scripts/pie-binary.mts WORK NAME
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The absolute pie-built-binary of every entry of `name` in the installed.json files of the targets under `work`. */
export function pieBinaries(work: string, name: string): string[] {
  const binaries: string[] = [];
  for (const target of existsSync(work) ? readdirSync(work) : []) {
    const composer = path.join(work, target, 'vendor', 'composer');
    const file = path.join(composer, 'installed.json');
    if (!existsSync(file)) continue;
    const installed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const packages = isRecord(installed) && Array.isArray(installed.packages) ? installed.packages : [];
    for (const entry of packages) {
      if (!isRecord(entry) || entry.name !== name) continue;
      const binary = isRecord(entry.extra) ? entry.extra['pie-built-binary'] : undefined;
      if (typeof binary === 'string') binaries.push(path.resolve(composer, binary));
    }
  }
  return binaries;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [work, name, ...rest] = process.argv.slice(2);
  if (work === undefined || name === undefined || rest.length > 0) {
    process.stderr.write('Usage: node scripts/pie-binary.mts WORK NAME\n');
    process.exit(2);
  }
  if (!NAME.test(name)) {
    process.stderr.write(`pie-binary: ${JSON.stringify(name)} is not a Composer package name vendor/name\n`);
    process.exit(1);
  }
  const binaries = pieBinaries(work, name);
  if (binaries.length !== 1) {
    process.stderr.write(`pie-binary: PIE recorded ${binaries.length} builds of ${name} in ${work}/*/vendor/composer/installed.json, not one: ${JSON.stringify(binaries)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${binaries[0]}\n`);
}
