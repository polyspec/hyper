#!/usr/bin/env node
// Prints the names of the production dependency closure of a workspace as package-lock.json names it, one per line: the
// dependencies of the workspace, their dependencies, and so on, each once, in the order they are first reached
// (H34.12). node-package packs each of them from the root install, because the offline install of the packed package
// resolves a dependency that is not packed through registry metadata, which npm ci never puts in the cache. A
// dependency that the lock links to a workspace (`link: true`) is followed into that workspace.
//
// Usage: node scripts/dependency-closure.mts --lock <package-lock.json> --workspace <path of the workspace>
import { readFileSync } from 'node:fs';

interface LockEntry {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly link?: boolean;
  readonly resolved?: string;
}

/** The closure of the dependencies of `workspace` in the `packages` map of a lock, failing on a name the lock lacks. */
export function dependencyClosure(packages: Readonly<Record<string, LockEntry>>, workspace: string): string[] {
  const root = packages[workspace];
  if (root === undefined) throw new Error(`the lock has no entry ${workspace}`);
  const seen: string[] = [];
  const pending = Object.keys(root.dependencies ?? {});
  for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
    if (seen.includes(name)) continue;
    seen.push(name);
    const installed = packages[`node_modules/${name}`];
    if (installed === undefined) throw new Error(`the lock has no entry node_modules/${name}, a dependency in the closure of ${workspace}`);
    const entry = installed.link === true && installed.resolved !== undefined ? packages[installed.resolved] : installed;
    if (entry === undefined) throw new Error(`the lock links node_modules/${name} to ${String(installed.resolved)}, which it has no entry of`);
    pending.push(...Object.keys(entry.dependencies ?? {}));
  }
  return seen;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const lock = args[0] === '--lock' ? args[1] : undefined;
  const workspace = args[2] === '--workspace' ? args[3] : undefined;
  if (lock === undefined || workspace === undefined || args.length !== 4) {
    process.stderr.write('Usage: node scripts/dependency-closure.mts --lock <package-lock.json> --workspace <path of the workspace>\n');
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(lock, 'utf8')) as { packages?: Record<string, LockEntry> };
  for (const name of dependencyClosure(parsed.packages ?? {}, workspace)) process.stdout.write(`${name}\n`);
}
