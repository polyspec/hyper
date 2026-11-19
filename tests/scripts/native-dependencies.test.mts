// Tests that every native crate of the bindings depends on each library that the binding contract names (H35.154). The
// generated code of a binding crate names the error types of those libraries, such as polyspec_http_form::Error, so a
// native crate that lacks the dependency does not compile ("cannot find module or crate `polyspec_http_form`"). A
// native crate is a tracked Cargo.toml under packages/ that depends on the core polyspec-hyper by its path; a library
// is a `library` value of packages/rust/interface.json other than the contract's own, and its crate is polyspec-<library>.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `library` values of the binding contract other than its own library. */
function contractLibraries(): string[] {
  const contract: unknown = JSON.parse(readFileSync(path.join(ROOT, 'packages/rust/interface.json'), 'utf8'));
  assert.ok(typeof contract === 'object' && contract !== null && !Array.isArray(contract), 'interface.json is no object');
  const own: unknown = Reflect.get(contract, 'library');
  assert.equal(typeof own, 'string', 'interface.json names no library of its own');
  const found = new Set<string>();
  const walk = (value: unknown, key: string): void => {
    if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) walk(v, k);
    else if (key === 'library' && typeof value === 'string' && value !== own) found.add(value);
  };
  for (const [key, value] of Object.entries(contract)) if (key !== 'library') walk(value, key);
  return [...found].sort();
}

/** The lines of the [dependencies] table of a Cargo manifest, by the name of each dependency. */
function dependencies(text: string): Map<string, string> {
  const found = new Map<string, string>();
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^\s*\[/u.test(line)) inTable = line.trim() === '[dependencies]';
    else if (inTable) {
      const entry = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line.trim());
      if (entry?.[1] !== undefined && entry[2] !== undefined) found.set(entry[1], entry[2]);
    }
  }
  return found;
}

/** The tracked native crates: each Cargo.toml under packages/ whose [dependencies] name polyspec-hyper by a path. */
function nativeManifests(): { file: string; names: Map<string, string> }[] {
  const files = execFileSync('git', ['ls-files', '--', 'packages/**/Cargo.toml'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((line) => line !== '');
  return files.map((file) => ({ file, names: dependencies(readFileSync(path.join(ROOT, file), 'utf8')) }))
    .filter(({ names }) => /\bpath\s*=/u.test(names.get('polyspec-hyper') ?? ''));
}

test('the binding contract names libraries and the tree holds native crates (H35.154)', () => {
  assert.ok(contractLibraries().length > 0, 'packages/rust/interface.json names no library');
  assert.ok(nativeManifests().length > 0, 'no tracked Cargo.toml under packages/ depends on polyspec-hyper by a path');
});

test('every native crate depends on the crate of each library that the binding contract names (H35.154)', () => {
  const missing: string[] = [];
  for (const { file, names } of nativeManifests()) {
    for (const library of contractLibraries()) {
      if (!names.has(`polyspec-${library}`)) missing.push(`${file}: polyspec-${library}`);
    }
  }
  assert.deepEqual(missing, [], `native crates without the dependency of a contract library:\n${missing.join('\n')}`);
});
