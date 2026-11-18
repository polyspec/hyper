#!/usr/bin/env node
// Prints the names of the production dependency closure of a workspace as package-lock.json names it, one per line: the
// dependencies of the workspace, their dependencies, and so on, each once, in the order they are first reached
// (H34.12). node-package packs each of them from the root install, because the offline install of the packed package
// resolves a dependency that is not packed through registry metadata, which npm ci never puts in the cache. A
// dependency that the lock links to a workspace (`link: true`) is followed into that workspace.
//
// Usage: node scripts/dependency-closure.mts --lock <package-lock.json> --workspace <path of the workspace>
import { readFileSync } from 'node:fs';
import { jsonObject, type JsonObject, jsonString, parseJsonObject } from './json.mts';

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

/** The entries of the `packages` map of a lock, each read for the members that the closure follows. */
function lockPackages(packages: JsonObject, lock: string): Record<string, LockEntry> {
  return Object.fromEntries(Object.entries(packages).map(([key, value]): [string, LockEntry] => {
    const where = `packages["${key}"] of ${lock}`;
    const entry = jsonObject(value, where);
    const dependencies = entry.dependencies === undefined
      ? undefined
      : Object.fromEntries(Object.entries(jsonObject(entry.dependencies, `${where}.dependencies`)).map(([name, range]) => [name, jsonString(range, `${where}.dependencies.${name}`)]));
    const link = entry.link === undefined ? undefined : entry.link === true;
    const resolved = entry.resolved === undefined ? undefined : jsonString(entry.resolved, `${where}.resolved`);
    return [key, { ...(dependencies === undefined ? {} : { dependencies }), ...(link === undefined ? {} : { link }), ...(resolved === undefined ? {} : { resolved }) }];
  }));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const lock = args[0] === '--lock' ? args[1] : undefined;
  const workspace = args[2] === '--workspace' ? args[3] : undefined;
  if (lock === undefined || workspace === undefined || args.length !== 4) {
    process.stderr.write('Usage: node scripts/dependency-closure.mts --lock <package-lock.json> --workspace <path of the workspace>\n');
    process.exit(2);
  }
  const parsed = parseJsonObject(readFileSync(lock, 'utf8'), lock);
  const packages = parsed.packages === undefined ? {} : lockPackages(jsonObject(parsed.packages, `packages of ${lock}`), lock);
  for (const name of dependencyClosure(packages, workspace)) process.stdout.write(`${name}\n`);
}
