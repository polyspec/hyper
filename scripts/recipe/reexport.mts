// The reexports of the spec (HYR-5 "Reexports"): a member or a unit of hyper that only passes a call to a library of
// `release`. The check compares no such entry with the sources; it verifies that the library unit or member exists in the
// interface.json that the locked crate polyspec-<library> ships, which cargo metadata of packages/rust/Cargo.toml finds.

import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isObject, type Finding, type ReexportMember, type SpecDocument } from './types.mts';

/** One reexport of the spec: `where` names the hyper unit or member, `target` is `<library>:<unit>[.<member>]`. */
export type Reexport = { where: string; target: string };

/** The members of a library by its interface.json: the file that was read and the ids of its units and members. */
export type LibraryInterface = { file: string; units: Set<string>; members: Set<string> };

export function isReexport(m: object): m is ReexportMember {
  return 'reexport' in m;
}

/** Every reexport of the spec, of its units and of their members. */
export function reexportsOf(doc: SpecDocument): Reexport[] {
  const out: Reexport[] = [];
  for (const c of doc.concerns) for (const u of c.units) {
    if (u.reexport !== undefined) out.push({ where: `unit ${u.id}`, target: u.reexport });
    for (const m of u.members) if (isReexport(m)) out.push({ where: `member ${m.id}`, target: m.reexport });
  }
  return out;
}

/** The library of a target: the part before `:`. */
function libraryOf(target: string): string {
  return target.slice(0, target.indexOf(':'));
}

/** The units and members that an interface.json lists by their ids. */
export function readInterface(file: string): LibraryInterface {
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const units = new Set<string>();
  const members = new Set<string>();
  const list = isObject(doc) && Array.isArray(doc.units) ? doc.units : [];
  for (const u of list) {
    if (!isObject(u) || typeof u.id !== 'string') continue;
    units.add(u.id);
    for (const m of Array.isArray(u.members) ? u.members : []) if (isObject(m) && typeof m.id === 'string') members.add(m.id);
  }
  return { file, units, members };
}

/**
 * The interface.json of each library that a reexport names, from the crate polyspec-<library> that cargo metadata
 * --locked --offline of packages/rust/Cargo.toml resolves with the cargo command `cargo` (the CARGO of the Makefile).
 * No cargo starts when no reexport names a library. A failing cargo throws with the install target that fetches the crates.
 */
export function libraryInterfaces(root: string, cargo: string[], libraries: Set<string>): Map<string, LibraryInterface> {
  const found = new Map<string, LibraryInterface>();
  if (libraries.size === 0) return found;
  const [program, ...words] = cargo;
  if (program === undefined) throw new Error('--cargo <command> is required: the spec states a reexport (HYR-5)');
  // The metadata goes into a file rather than a pipe, so its size meets no buffer limit of the child process.
  const scratch = mkdtempSync(path.join(tmpdir(), 'hyper-recipe-metadata-'));
  let metadata: unknown;
  try {
    const out = path.join(scratch, 'metadata.json');
    const fd = openSync(out, 'w');
    try {
      const run = spawnSync(program, [...words, 'metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', path.join(root, 'packages', 'rust', 'Cargo.toml')], { stdio: ['ignore', fd, 'inherit'] });
      if (run.error !== undefined) throw run.error;
      if (run.status !== 0) throw new Error(`cargo metadata failed with status ${String(run.status)}; run make hyper-install-crates, which fetches the crates of Cargo.lock`);
    } finally {
      closeSync(fd);
    }
    const parsed: unknown = JSON.parse(readFileSync(out, 'utf8'));
    metadata = parsed;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const packages: unknown[] = isObject(metadata) && Array.isArray(metadata.packages) ? metadata.packages : [];
  for (const library of libraries) {
    const crate: unknown = packages.find((p) => isObject(p) && p.name === `polyspec-${library}`);
    if (!isObject(crate) || typeof crate.manifest_path !== 'string') continue;
    found.set(library, readInterface(path.join(path.dirname(crate.manifest_path), 'interface.json')));
  }
  return found;
}

/** REEXPORT_MISSING for each reexport whose library is not locked or whose interface.json lists no such unit or member. */
export function checkReexports(reexports: Reexport[], interfaces: Map<string, LibraryInterface>): Finding[] {
  const findings: Finding[] = [];
  for (const r of reexports) {
    const library = libraryOf(r.target);
    const name = r.target.slice(library.length + 1);
    const lib = interfaces.get(library);
    if (lib === undefined) {
      findings.push({ code: 'REEXPORT_MISSING', message: `${r.where} reexports ${r.target}; packages/rust/Cargo.toml locks no crate polyspec-${library}` });
      continue;
    }
    const listed = name.includes('.') ? lib.members : lib.units;
    if (!listed.has(name)) findings.push({ code: 'REEXPORT_MISSING', message: `${r.where} reexports ${r.target}, which ${lib.file} does not list` });
  }
  return findings;
}

/** The findings of the reexports of a spec, read through the cargo command `cargo`. */
export function reexportFindings(root: string, doc: SpecDocument, cargo: string[]): Finding[] {
  const reexports = reexportsOf(doc);
  const interfaces = libraryInterfaces(root, cargo, new Set(reexports.map((r) => libraryOf(r.target))));
  return checkReexports(reexports, interfaces);
}
