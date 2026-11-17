#!/usr/bin/env node
// Writes and checks the digest of the sources that make hyper-install-python built into the venv (HR-85, H34.17). The
// venv holds polyspec-hyper non-editable (kit K788), so a test of the venv reads the package of the tree that was
// installed, not the tree that is checked out. `write` stores the sha256 of the installed sources in the venv; `check`,
// which make hyper-test-python runs first, fails and names make hyper-install-python when the digest is missing or is
// not the digest of the sources of the tree. The sources are the tracked files of packages/python outside its tests,
// which the wheel is built from, and Cargo.lock, which pins the crates of its native module; a file is read from the
// working tree, so an uncommitted edit changes the digest too.
//
// Usage: node scripts/python-install-stamp.mts write|check VENV
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STAMP = 'hyper-sources.sha256';
const PACKAGE = 'packages/python';
const INSTALL = 'make hyper-install-python';

/** The sha256 of the sources of the Python package in the checkout `root`. */
export function sourcesDigest(root: string): string {
  const listed = execFileSync('git', ['ls-files', '-z', '--', PACKAGE, 'Cargo.lock'], { cwd: root, encoding: 'utf8' });
  const files = listed.split('\0').filter((file) => file !== '' && !file.startsWith(`${PACKAGE}/tests/`)).sort();
  if (files.length === 0) throw new Error(`${root}: git lists no file of ${PACKAGE}`);
  const hash = createHash('sha256');
  for (const file of files) {
    const absolute = path.join(root, file);
    hash.update(`${file}\0`);
    hash.update(existsSync(absolute) ? readFileSync(absolute) : '\0deleted');
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Stores the digest of the sources of `root` in `venv`. */
export function writeStamp(venv: string, root: string): void {
  writeFileSync(path.join(venv, STAMP), `${sourcesDigest(root)}\n`);
}

/** Why the package installed in `venv` is not the one of the sources of `root`, or undefined when it is. */
export function stampProblem(venv: string, root: string): string | undefined {
  const file = path.join(venv, STAMP);
  if (!existsSync(file)) return `${file}: no digest of the installed sources; run ${INSTALL}`;
  const installed = readFileSync(file, 'utf8').trim();
  const current = sourcesDigest(root);
  if (installed !== current) return `${venv}: the installed polyspec-hyper is older than the sources of the tree (installed ${installed}, tree ${current}); run ${INSTALL}`;
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, venv] = process.argv.slice(2);
  if ((mode !== 'write' && mode !== 'check') || venv === undefined) {
    process.stderr.write('Usage: node scripts/python-install-stamp.mts write|check VENV\n');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    if (mode === 'write') writeStamp(venv, root);
    else {
      const problem = stampProblem(venv, root);
      if (problem !== undefined) {
        process.stderr.write(`python-install-stamp: ${problem}\n`);
        process.exit(1);
      }
    }
  } catch (error) {
    process.stderr.write(`python-install-stamp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
