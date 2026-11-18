#!/usr/bin/env node
// Writes and checks the versions of the sibling polyspec releases (HR-70, HR-80, HR-89, H35.75, H35.76).
// config/pins.json declares the release of each sibling package: its repository and its version. A place is a text
// of a tracked file that names one of them:
//   - a release asset URL github.com/polyspec/<repository>/releases/download/v<version>/<asset>, whose package is the
//     longest declared name that the asset starts with after `polyspec-` or `polyspec_`, or the repository for another
//     asset such as packages.json; a wheel URL carries the sha256 of its asset after `#sha256=`;
//   - a plain npm requirement "@polyspec/<package>": "<version>";
//   - a Cargo tag github.com/polyspec/<repository>.git", tag = "v<version>" and a Cargo.lock source
//     github.com/polyspec/<repository>.git?tag=v<version>;
//   - a Composer platform version "ext-polyspec_<package>": "<version>";
//   - a Makefile variable <PACKAGE>_VERSION := <version>;
//   - the version of an entry of config/php-ext-pins.json, after the line of its repository;
//   - a Go module github.com/polyspec/<repository>/packages/go v<version>.
// A name that config/pins.json does not declare, such as kit or hyper itself, is no place.
//
// `check` reads every place of the tracked files, offline, and fails at each one that names another version than the
// declared one, with its file and line; it fails when it finds no place (HR-84). `write` sets the given versions in
// config/pins.json and rewrites the places of the files that no tool writes, and of the Cargo manifests of the bindings
// and go.mod, which binding scaffold writes again (H35.75-1); the locks and go.sum are left to the lock targets, whose
// make arguments it prints one per line. A wheel whose version changes takes the sha256 of the field digest of its release asset from the
// releases API; an asset without one, or a package that config/pins.json does not declare, stops the script before it
// writes. Each file is written with one rename (HR-82), and a second run with the same versions writes nothing.
//
// `write --locks DIR` also writes the lock goals in DIR/locks-1.* and locks-2.*, the groups that make pin-locks runs
// one make call each (lockGroups): one make runs a goal once, and a binding change needs cargo-lock again after
// bindings-scaffold.
//
// Usage: node scripts/pin.mts check [--root DIR]
//        node scripts/pin.mts write [--root DIR] [--locks DIR] [<package>=<version>]...
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';

/** The response of releases/tags/v`version` of `repository`, or undefined. */
export type ReleaseOf = (repository: string, version: string) => unknown;

type Declared = Record<string, { repository: string; version: string }>;
type Place = { line: number; key: string; version: string };

const PINS = 'config/pins.json';
const V = String.raw`(\d+\.\d+\.\d+)`;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The declared releases of config/pins.json under `root`. */
function declaredOf(root: string): Declared {
  const pins: unknown = JSON.parse(readFileSync(path.join(root, PINS), 'utf8'));
  if (!isRecord(pins) || !isRecord(pins.versions)) throw new Error(`${PINS} has no member versions`);
  const out: Declared = {};
  for (const [key, entry] of Object.entries(pins.versions)) {
    if (!isRecord(entry) || typeof entry.repository !== 'string' || typeof entry.version !== 'string') throw new Error(`${PINS}: ${key} names no repository and version`);
    out[key] = { repository: entry.repository, version: entry.version };
  }
  return out;
}

/** The tracked files that may hold a place: the manifests, the locks, the Makefile and config/php-ext-pins.json. */
function filesOf(root: string): string[] {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const names = new Set(['package.json', 'package-lock.json', 'Cargo.toml', 'Cargo.lock', 'composer.json', 'composer.lock', 'pyproject.toml', 'uv.lock', 'go.mod', 'go.sum', 'Makefile']);
  // The fixtures of the tests hold the places of other trees, which their tests read.
  return listed.filter((file) => !file.startsWith('tests/scripts/fixtures/') && (names.has(path.posix.basename(file)) || file === 'config/php-ext-pins.json'));
}

/**
 * A file that a tool writes: a lock and go.sum, whose sums come from Go. The Cargo manifests of the bindings and go.mod
 * are written here too, although binding scaffold writes them again, so that no cargo-lock before bindings-scaffold
 * sees two versions of one crate (H35.75-1).
 */
function writtenByTool(file: string): boolean {
  return ['package-lock.json', 'Cargo.lock', 'composer.lock', 'uv.lock', 'go.sum'].includes(path.posix.basename(file));
}

/** The declared package of an asset of the release of `repository`. */
function assetKey(declared: Declared, repository: string, asset: string): string | undefined {
  const rest = /^polyspec[-_](.*)$/.exec(asset)?.[1];
  if (rest === undefined) return repositoryKey(declared, repository);
  const keys = Object.keys(declared).filter((key) => rest.startsWith(`${key}-`) || rest.startsWith(`${key.replaceAll('-', '_')}-`));
  return keys.sort((a, b) => b.length - a.length)[0];
}

/**
 * The declared package of a repository name: the package of that name, or else the one package of that repository. A
 * repository that publishes two packages, as php-serialization publishes php-serialize, names its own by its crate, its
 * Go module and its Composer repository.
 */
const repositoryKey = (declared: Declared, repository: string): string | undefined =>
  declared[repository]?.repository === `polyspec/${repository}` ? repository : Object.keys(declared).find((key) => declared[key]?.repository === `polyspec/${repository}`);

type Rule = { pattern: RegExp; key: (declared: Declared, match: RegExpExecArray) => string | undefined; version: number };

const RULES: Rule[] = [
  { pattern: new RegExp(String.raw`github\.com/polyspec/([a-z-]+)/releases/download/v${V}/([^"'\s#]+)`, 'g'), key: (d, m) => assetKey(d, m[1] ?? '', m[3] ?? ''), version: 2 },
  { pattern: new RegExp(String.raw`"@polyspec/([a-z-]+)": "${V}"`, 'g'), key: (d, m) => (m[1] !== undefined && m[1] in d ? m[1] : undefined), version: 2 },
  { pattern: new RegExp(String.raw`github\.com/polyspec/([a-z-]+)\.git(?:", tag = "|\?tag=)v${V}`, 'g'), key: (d, m) => repositoryKey(d, m[1] ?? ''), version: 2 },
  { pattern: new RegExp(String.raw`"ext-polyspec_([a-z_]+)": "${V}"`, 'g'), key: (d, m) => { const k = (m[1] ?? '').replaceAll('_', '-'); return k in d ? k : undefined; }, version: 2 },
  { pattern: new RegExp(String.raw`^([A-Z_]+)_VERSION := ${V}$`, 'g'), key: (d, m) => { const k = (m[1] ?? '').toLowerCase().replaceAll('_', '-'); return k in d ? k : undefined; }, version: 2 },
  { pattern: new RegExp(String.raw`github\.com/polyspec/([a-z-]+)/packages/go v${V}`, 'g'), key: (d, m) => repositoryKey(d, m[1] ?? ''), version: 2 },
];

/** The places of the text of `file`, each with its line, its package and the version that it names. */
export function placesOf(file: string, text: string, declared: Declared): Place[] {
  const places: Place[] = [];
  let extension: string | undefined;
  text.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        const key = rule.key(declared, match);
        // A release URL names its version twice, in its tag and in its asset; an asset that names another version than
        // its tag is a place of that other version.
        const tag = match[rule.version];
        const version = rule === RULES[0] ? ((match[3] ?? '').match(/\d+\.\d+\.\d+/g) ?? []).find((v) => v !== tag) ?? tag : tag;
        if (key !== undefined && version !== undefined) places.push({ line: index + 1, key, version });
      }
    }
    if (file === 'config/php-ext-pins.json') {
      const repository = /"repository": "polyspec\/([a-z-]+)"/.exec(line)?.[1];
      if (repository !== undefined) extension = repositoryKey(declared, repository);
      const version = new RegExp(`"version": "${V}"`).exec(line)?.[1];
      if (version !== undefined && extension !== undefined) places.push({ line: index + 1, key: extension, version });
    }
  });
  return places;
}

/** The places of the tree of `root` that name another version than the declared one, and the count of all places. */
export function checkTree(root: string): { places: number; differ: string[] } {
  const declared = declaredOf(root);
  let places = 0;
  const differ: string[] = [];
  for (const file of filesOf(root)) {
    for (const place of placesOf(file, readFileSync(path.join(root, file), 'utf8'), declared)) {
      places += 1;
      const want = declared[place.key]?.version;
      if (place.version !== want) differ.push(`${file}:${place.line}: ${place.key} is ${place.version}, ${PINS} declares ${want}`);
    }
  }
  return { places, differ };
}

/** The sha256 of the asset `asset` of the release response `release`, or undefined. */
function digestOf(release: unknown, asset: string): string | undefined {
  const assets = isRecord(release) && Array.isArray(release.assets) ? release.assets.filter(isRecord) : [];
  const digest = assets.find((entry) => entry.name === asset)?.digest;
  return typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1] : undefined;
}

/** The text of `file` with every place of a package of `changed` at its new version, and the assets without a digest. */
function rewrite(file: string, text: string, declared: Declared, changed: Record<string, string>, release: ReleaseOf, missing: string[]): string {
  const lines = text.split('\n');
  // The places of the whole text, by line: an entry of config/php-ext-pins.json names its package on an earlier line.
  const byLine = new Map<number, Place[]>();
  for (const place of placesOf(file, text, declared)) byLine.set(place.line, [...(byLine.get(place.line) ?? []), place]);
  return lines
    .map((line, index) => {
      for (const place of byLine.get(index + 1) ?? []) {
        const to = changed[place.key];
        if (to === undefined || place.version === to) continue;
        const from = place.version;
        const wheel = new RegExp(String.raw`(github\.com/polyspec/[a-z-]+/releases/download/v)${from.replaceAll('.', '\\.')}(/[^"'\s#]*?)${from.replaceAll('.', '\\.')}([^"'\s#]*\.whl#sha256=)[0-9a-f]{64}`);
        const match = wheel.exec(line);
        if (match !== null) {
          const asset = `${(match[2] ?? '').slice(1)}${to}${(match[3] ?? '').replace(/#sha256=$/, '')}`;
          const sha = digestOf(release(declared[place.key]?.repository ?? '', to), asset);
          if (sha === undefined) {
            missing.push(asset);
            continue;
          }
          line = line.replace(wheel, `$1${to}$2${to}$3${sha}`);
          continue;
        }
        line = line.replaceAll(from, to);
      }
      return line;
    })
    .join('\n');
}

/** The make arguments of the lock targets that follow a change of the packages of `keys` in the files `written`. */
function targetsOf(declared: Declared, keys: string[], written: string[], before: Map<string, string>, root: string): string[] {
  const targets: string[] = [];
  const crates = new Set<string>();
  for (const file of written.filter((f) => path.posix.basename(f) === 'Cargo.toml')) {
    const old = before.get(file)?.split('\n') ?? [];
    readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      const crate = /^([a-z0-9-]+) = \{ git = "https:\/\/github\.com\/polyspec\//.exec(line)?.[1];
      if (crate !== undefined && line !== old[index]) crates.add(crate);
    });
  }
  if (keys.includes('binding')) crates.add('polyspec-binding-core');
  // One cargo-lock names every changed crate, since cargo update reads the lock once; a goal that comes twice starts
  // the second make call of make pin, so the goals fit two calls: the core before bindings-scaffold, then the rest.
  const cargo = `cargo-lock ${[...crates].map((crate) => `CRATES=${crate}`).join(' ')}`;
  const scaffold = crates.size > 0 || keys.includes('binding') || keys.includes('json');
  if (written.some((f) => path.posix.basename(f) === 'package.json')) targets.push('npm-lock', 'install-packages');
  if (crates.size > 0) targets.push(cargo);
  if (scaffold) targets.push('bindings-scaffold');
  if (scaffold && crates.size > 0) targets.push(cargo);
  // composer-lock updates the packages whose places a written composer.json holds, all in one goal.
  const composer = new Set(written.filter((f) => path.posix.basename(f) === 'composer.json').flatMap((f) => placesOf(f, readFileSync(path.join(root, f), 'utf8'), declared).map((place) => place.key)));
  const packages = keys.filter((key) => composer.has(key));
  if (packages.length > 0) targets.push(`composer-lock ${packages.map((key) => `PACKAGES=${declared[key]?.repository}`).join(' ')}`);
  if (written.includes('config/php-ext-pins.json')) targets.push('php-ext-pins');
  if (written.some((f) => path.posix.basename(f) === 'pyproject.toml')) targets.push('python-lock');
  return targets;
}

/**
 * Sets the versions `versions` in config/pins.json under `root` and rewrites the places of the files that no tool
 * writes; it gives the files that it wrote and the make arguments of the lock targets that write the others.
 */
export function pinFiles(root: string, versions: Record<string, string>, release: ReleaseOf): { written: string[]; targets: string[] } {
  const declared = declaredOf(root);
  for (const [key, version] of Object.entries(versions)) {
    if (!(key in declared)) throw new Error(`${PINS} declares no package ${key}`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${key}=${version} is no version`);
  }
  const changed = Object.fromEntries(Object.entries(versions).filter(([key, version]) => declared[key]?.version !== version));
  const keys = Object.keys(changed);
  if (keys.length === 0) return { written: [], targets: [] };
  const missing: string[] = [];
  const texts = new Map<string, string>();
  const before = new Map<string, string>();
  for (const file of filesOf(root).filter((f) => !writtenByTool(f))) {
    const text = readFileSync(path.join(root, file), 'utf8');
    const next = rewrite(file, text, declared, changed, release, missing);
    if (next !== text) {
      texts.set(file, next);
      before.set(file, text);
    }
  }
  if (missing.length > 0) throw new Error(`no sha256 digest of the release asset ${missing.join(', ')}; nothing is written`);
  const pinsText = readFileSync(path.join(root, PINS), 'utf8');
  let nextPins = pinsText;
  for (const key of keys) {
    const entry = declared[key];
    nextPins = nextPins.replace(`"${key}": { "repository": "${entry?.repository}", "version": "${entry?.version}" }`, `"${key}": { "repository": "${entry?.repository}", "version": "${changed[key]}" }`);
  }
  texts.set(PINS, nextPins);
  for (const [file, text] of texts) writeFileAtomic(path.join(root, file), text);
  const written = [...texts.keys()];
  return { written, targets: targetsOf(declared, keys, written, before, root) };
}

/**
 * The lock goals of `targets` in groups that one make call each runs in order: a goal that a group holds already starts
 * the next group, since one make runs a goal once.
 */
export function lockGroups(targets: string[]): string[][] {
  const groups: string[][] = [[]];
  for (const target of targets) {
    const goal = target.split(' ')[0] ?? '';
    const current = groups[groups.length - 1] ?? [];
    if (current.some((t) => t.split(' ')[0] === goal)) groups.push([target]);
    else current.push(target);
  }
  return groups.filter((group) => group.length > 0);
}

/**
 * The files of one group that make pin-locks reads with cat: `goals`, its goals in order, `crates`, the crates of
 * cargo-lock, and `packages`, the packages of composer-lock.
 */
export function lockFiles(group: string[]): Record<'goals' | 'crates' | 'packages', string> {
  const values = (name: string): string[] => group.flatMap((t) => t.split(' ').slice(1)).filter((w) => w.startsWith(`${name}=`)).map((w) => w.slice(name.length + 1));
  const goals = [...new Set(group.map((t) => t.split(' ')[0] ?? ''))];
  return { goals: `${goals.join(' ')}\n`, crates: `${values('CRATES').join(' ')}\n`, packages: `${values('PACKAGES').join(' ')}\n` };
}

/** Reads the release responses of the packages of `versions` from the GitHub releases API. */
async function releases(root: string, versions: Record<string, string>): Promise<ReleaseOf> {
  const declared = declaredOf(root);
  const responses = new Map<string, unknown>();
  for (const [key, version] of Object.entries(versions)) {
    const repository = declared[key]?.repository;
    if (repository === undefined || declared[key]?.version === version) continue;
    const url = `https://api.github.com/repos/${repository}/releases/tags/v${version}`;
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    responses.set(`${repository} ${version}`, await response.json());
  }
  return (repository, version) => responses.get(`${repository} ${version}`);
}

async function main(args: string[]): Promise<number> {
  const usage = 'Usage: node scripts/pin.mts check [--root DIR]\n       node scripts/pin.mts write [--root DIR] [--locks DIR] [<package>=<version>]...\n';
  const [mode, ...rest] = args;
  const option = (name: string): [string | undefined, number] => {
    const at = rest.indexOf(name);
    return [at >= 0 ? rest[at + 1] : undefined, at];
  };
  const [rootGiven, rootAt] = option('--root');
  const [locks, locksAt] = option('--locks');
  const root = rootAt >= 0 ? rootGiven : '.';
  const skipped = new Set([rootAt, locksAt].filter((at) => at >= 0).flatMap((at) => [at, at + 1]));
  const pairs = rest.filter((_, index) => !skipped.has(index));
  if (root === undefined || (mode !== 'check' && mode !== 'write') || (mode === 'check' && pairs.length > 0) || pairs.some((pair) => !pair.includes('='))) {
    process.stderr.write(usage);
    return 2;
  }
  if (mode === 'check') {
    const { places, differ } = checkTree(root);
    if (places === 0) {
      process.stderr.write(`pin-check: no tracked file names a release that ${PINS} declares\n`);
      return 1;
    }
    if (differ.length > 0) {
      process.stderr.write(`${differ.join('\n')}\npin-check: ${differ.length} of ${places} places name another version than ${PINS}\n`);
      return 1;
    }
    process.stdout.write(`pin-check: ${places} places name the versions of ${PINS}\n`);
    return 0;
  }
  const versions = Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  const { written, targets } = pinFiles(root, versions, await releases(root, versions));
  process.stdout.write(`pin: wrote ${written.length} files${written.length > 0 ? `: ${written.join(', ')}` : ''}\n`);
  if (locks !== undefined) {
    const groups = lockGroups(targets);
    mkdirSync(locks, { recursive: true });
    for (const [index, group] of [groups[0] ?? [], groups[1] ?? []].entries()) {
      for (const [name, text] of Object.entries(lockFiles(group))) writeFileAtomic(path.join(locks, `locks-${index + 1}.${name}`), text);
      process.stdout.write(`pin: lock goals ${index + 1}: ${group.length > 0 ? group.join(' ') : 'none'}\n`);
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`pin: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
