// The fixed case files of tests/legacy: copies of case files that a library holds now, with their caseFiles declaration,
// which the steps of the three servers read until the servers call the core and S-4 removes the directory. The check
// reads them as case files of the spec, each from tests/legacy instead of contracts/.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isObject, type Json } from './types.mts';

export const LEGACY_DIR = path.join('tests', 'legacy');

/** The caseFiles of tests/legacy/interfaces.json, or none when the directory is gone. */
function legacyCaseFiles(root: string): Json {
  const full = path.join(root, LEGACY_DIR, 'interfaces.json');
  if (!existsSync(full)) return {};
  const doc: unknown = JSON.parse(readFileSync(full, 'utf8'));
  if (!isObject(doc) || !isObject(doc.caseFiles)) throw new Error(`${full} holds no caseFiles`);
  return doc.caseFiles;
}

/** The spec document with the fixed case files of tests/legacy among its case files, before it is validated. */
export function withLegacy(root: string, specDoc: unknown): unknown {
  if (!isObject(specDoc) || !isObject(specDoc.caseFiles)) return specDoc;
  return { ...specDoc, caseFiles: { ...specDoc.caseFiles, ...legacyCaseFiles(root) } };
}

/**
 * The installed path of a case file that a release of another library publishes (`release` of its caseFiles entry,
 * H35.11): var/release-files/<library>/<tag>/contracts/<key>, from the tag of config/release-files.json, or none for a
 * case file of this repository.
 */
function releaseFileName(root: string, key: string): string | undefined {
  const doc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  const entry = isObject(doc) && isObject(doc.caseFiles) ? doc.caseFiles[key] : undefined;
  const library = isObject(entry) ? entry.release : undefined;
  if (typeof library !== 'string') return undefined;
  const pins: unknown = JSON.parse(readFileSync(path.join(root, 'config', 'release-files.json'), 'utf8'));
  const release = isObject(pins) && isObject(pins.releases) ? pins.releases[library] : undefined;
  if (!isObject(release) || typeof release.tag !== 'string') throw new Error(`config/release-files.json pins no release of ${library}, which contracts/interfaces.json names for ${key}`);
  const name = `var/release-files/${library}/${release.tag}/contracts/${key}`;
  if (!existsSync(path.join(root, name))) throw new Error(`${name} is missing; \`make hyper-install-release-files\` writes it`);
  return name;
}

/**
 * The repository path of a case file, as a concern names it: tests/legacy/<key> for a fixed case file, the installed
 * file of a release for a case file of another library, else contracts/<key>.
 */
export function caseFileName(root: string, key: string): string {
  if (Object.hasOwn(legacyCaseFiles(root), key)) return `tests/legacy/${key}`;
  return releaseFileName(root, key) ?? `contracts/${key}`;
}

/** The path of a case file: under tests/legacy for a fixed case file, under var/release-files for a release file, under contracts/ for every other one. */
export function caseFilePath(root: string, key: string): string {
  return path.join(root, caseFileName(root, key));
}
