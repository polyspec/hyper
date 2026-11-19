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
import { parse } from 'smol-toml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `library` values of the binding contract other than its own library. */
function contractLibraries(): string[] {
  const contract = JSON.parse(readFileSync(path.join(ROOT, 'packages/rust/interface.json'), 'utf8')) as { library: string };
  const found = new Set<string>();
  const walk = (value: unknown, key: string): void => {
    if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) walk(v, k);
    else if (key === 'library' && typeof value === 'string' && value !== contract.library) found.add(value);
  };
  for (const [key, value] of Object.entries(contract)) if (key !== 'library') walk(value, key);
  return [...found].sort();
}

type Manifest = { dependencies?: Record<string, unknown> };

/** The tracked native crates: each Cargo.toml under packages/ that depends on polyspec-hyper by a path. */
function nativeManifests(): { file: string; manifest: Manifest }[] {
  const files = execFileSync('git', ['ls-files', '--', 'packages/**/Cargo.toml'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((line) => line !== '');
  return files.map((file) => ({ file, manifest: parse(readFileSync(path.join(ROOT, file), 'utf8')) as Manifest }))
    .filter(({ manifest }) => {
      const core = manifest.dependencies?.['polyspec-hyper'];
      return typeof core === 'object' && core !== null && 'path' in core;
    });
}

test('the binding contract names libraries and the tree holds native crates (H35.154)', () => {
  assert.ok(contractLibraries().length > 0, 'packages/rust/interface.json names no library');
  assert.ok(nativeManifests().length > 0, 'no tracked Cargo.toml under packages/ depends on polyspec-hyper by a path');
});

test('every native crate depends on the crate of each library that the binding contract names (H35.154)', () => {
  const missing: string[] = [];
  for (const { file, manifest } of nativeManifests()) {
    for (const library of contractLibraries()) {
      if (manifest.dependencies?.[`polyspec-${library}`] === undefined) missing.push(`${file}: polyspec-${library}`);
    }
  }
  assert.deepEqual(missing, [], `native crates without the dependency of a contract library:\n${missing.join('\n')}`);
});
