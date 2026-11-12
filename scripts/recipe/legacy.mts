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

/** The repository path of a case file, as a concern names it: tests/legacy/<key> for a fixed case file, else contracts/<key>. */
export function caseFileName(root: string, key: string): string {
  return Object.hasOwn(legacyCaseFiles(root), key) ? `tests/legacy/${key}` : `contracts/${key}`;
}

/** The path of a case file: under tests/legacy for a fixed case file, under contracts/ for every other one. */
export function caseFilePath(root: string, key: string): string {
  return path.join(root, caseFileName(root, key));
}

/**
 * A fixed copy of the S-3b case changes: `<name>-before-s3b.json` holds sections of `<name>.json` as they were before
 * those changes, which the host runners read until the commit that moves their rules to the core (C-7) makes the
 * sections live again. Its steps are those of `<name>.json`, and its sentences may name the statements that S-3b retired.
 */
export function isFixedCopy(key: string): boolean {
  return key.endsWith('-before-s3b.json');
}

/** The case file whose steps a case file runs: `<name>.json` for its fixed copy, else the file itself. */
export function liveFile(key: string): string {
  return isFixedCopy(key) ? key.replace(/-before-s3b\.json$/u, '.json') : key;
}
