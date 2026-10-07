#!/usr/bin/env node
// Release a tag of a commit of main: the steps of .github/workflows/release.yml.
//
//   node scripts/release.mjs verify <tag>     the tagged commit is on main and passed the checks push-gate and ci-passed
//   node scripts/release.mjs versions <tag>   every manifest of the tag has its version and CHANGELOG.md its section
//   node scripts/release.mjs assets <tag>     build the archive of every package of the tag into var/release/assets
//   node scripts/release.mjs publish <tag>    create the GitHub Release of the tag with its notes and archives
//
// Every change reaches main through the merge queue with the required checks, so every commit of main passed the full
// suite; the maintainer releases by tagging a commit of main after a version-bump pull request, and a tag push runs these
// steps in order. A tag `vX.Y.Z` releases the packages of PACKAGES at version X.Y.Z; a tag `<directory>/vX.Y.Z` releases
// the Go module of that directory (GO_MODULES), which needs no archive, and this repository has none. No step reruns the
// tests.
//
// `verify` resolves the tag to its commit, requires that commit to be an ancestor of origin/main (`git merge-base
// --is-ancestor`) and reads the check runs of the commit from the GitHub API (`gh api
// repos/<repository>/commits/<sha>/check-runs`, the repository of GITHUB_REPOSITORY): the latest run of each of
// push-gate and ci-passed must be completed with the conclusion success. `versions` compares X.Y.Z with the version of
// every manifest of MANIFESTS (a composer.json without a `version` field takes its version from the tag, as Composer
// does) and requires the section `## X.Y.Z` in CHANGELOG.md. `assets` builds one archive per package, named
// `<package name>-<version>.<ext>` with `@scope/` written as `scope-` and `vendor/` as `vendor-`: `npm pack` of the built
// package (.tgz; `make release-assets` builds the packages first) and a zip of the directory of a Composer package from
// `git archive` of the tagged commit (.zip), each with the manifest of the tree unchanged. A published manifest names
// every polyspec package by an exact version and a composer.json declares its version and no repositories, so a
// consumer installs the archives together, npm tarballs as file: dependencies and Composer zips from an artifact
// repository. `assets` fails for a packed manifest of manifestProblems and for one that differs from its source; the release assets are npm tarballs and Composer zips only, and a Cargo
// package is not released as an archive: it is consumed by git tag, because `cargo package` rewrites git dependencies
// into crates.io requirements that do not resolve. A Go tag builds and attaches nothing. `publish` runs `gh release create TAG --verify-tag --title TAG --notes-file
// <notes>` with the archives of `assets`: the notes are the section X.Y.Z when it has at most NOTES_LIMIT characters, and
// otherwise the one line `The changes of X.Y.Z are listed in [CHANGELOG.md](<link>).`, whose link is CHANGELOG.md at the
// tag with the anchor of the section: the id of an `<a id="...">` line above `## X.Y.Z`, or else X.Y.Z without its dots. Each failure names the tag, the file or check and both values, and
// exits with status 1.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/release.mjs verify|versions|assets|publish <tag>';
export const MAIN = 'origin/main';
export const CHECKS = ['push-gate', 'ci-passed'];
export const CHANGELOG = 'CHANGELOG.md';
export const ASSETS = 'var/release/assets';
// The repository whose files the notes of a release link.
export const REPOSITORY = 'polyspec/hyper';
// The longest body of a GitHub Release, in characters: GitHub refuses a longer one.
export const NOTES_LIMIT = 125000;
// The packages that a tag vX.Y.Z releases, one archive each: npm tarballs and Composer zips only.
export const PACKAGES = [
  { kind: 'npm', directory: 'packages/hyper-js', name: '@polyspec/hyper' },
  { kind: 'npm', directory: 'packages/hyper-node', name: '@polyspec/hyper-server' },
  { kind: 'composer', directory: 'packages/hyper-php', name: 'polyspec/hyper' },
];
// The manifests whose version a tag vX.Y.Z sets: those of the packages and the private workspace of the repository root.
export const MANIFESTS = ['package.json', 'packages/hyper-js/package.json', 'packages/hyper-node/package.json', 'packages/hyper-php/composer.json'];
// A tracked Cargo.toml is listed in NOT_RELEASED with this reason; this repository tracks none.
export const GIT_TAG = 'not released as an archive; consumed by git tag';
// The tracked manifests that no tag releases, with the reason.
export const NOT_RELEASED = {
  'tests/package-install/package.json': 'the test package that installs the npm archives of the packages',
  'examples/board/composer.json': 'the example application, which installs the packages from the checkout',
  'composer.json': 'the private development root of packages/hyper-php, which resolves the packages from the checkout',
};
// The Go modules: a tag <directory>/vX.Y.Z releases the module of that directory. This repository has none.
export const GO_MODULES = {};
// The dependency fields of a packed manifest that name polyspec packages.
const NPM_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const COMPOSER_FIELDS = ['require', 'require-dev'];
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const TAG = /^(?:(?<directory>[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\/)?v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const EXTENSIONS = { npm: 'tgz', composer: 'zip' };

export class Stop extends Error {}

/** [Go module directory or null, version] of a release tag. */
export function parseTag(tag) {
  const found = TAG.exec(tag);
  if (!found) throw new Stop(`${tag}: a release tag is vX.Y.Z or <Go module directory>/vX.Y.Z`);
  const directory = found.groups.directory ?? null;
  if (directory !== null && !(directory in GO_MODULES)) {
    throw new Stop(`${tag}: ${directory} is not a Go module directory; the Go modules are [${Object.keys(GO_MODULES).sort().join(', ')}]`);
  }
  return [directory, found.groups.version];
}

/** The standard output of a command; Stop with the command, its exit status and its standard error. */
function run(command, args, { cwd, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Stop(`${[command, ...args].join(' ')} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Stop(`${[command, ...args].join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

const taggedCommit = (root, tag) => run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: root }).trim();

/** The tagged commit is on main and the latest run of every check of CHECKS concluded success. */
export function verify(root, tag, repository) {
  parseTag(tag);
  if (!repository) throw new Stop('GITHUB_REPOSITORY is not set; it names the repository <owner>/<name> whose check runs are read');
  const commit = taggedCommit(root, tag);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', commit, MAIN], { cwd: root, encoding: 'utf8' });
  if (ancestry.status === 1) throw new Stop(`${tag}: the commit ${commit} is not on ${MAIN}; a release tags a commit of main`);
  if (ancestry.status !== 0) throw new Stop(`git merge-base --is-ancestor ${commit} ${MAIN} exited with ${ancestry.status}: ${(ancestry.stderr ?? '').trim()}`);
  const listed = run('gh', ['api', '--paginate', `repos/${repository}/commits/${commit}/check-runs?per_page=100`, '--jq', '.check_runs[] | [.id, .name, .status, .conclusion] | @json'], { cwd: root });
  const runs = listed.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const problems = [];
  for (const name of CHECKS) {
    const named = runs.filter((entry) => entry[1] === name);
    if (named.length === 0) {
      problems.push(`the check ${name} is missing`);
      continue;
    }
    const [, , status, conclusion] = named.reduce((latest, entry) => (entry[0] > latest[0] ? entry : latest));
    if (status !== 'completed' || conclusion !== 'success') problems.push(`the check ${name} is ${status} with the conclusion ${conclusion}, not success`);
  }
  if (problems.length > 0) throw new Stop(`${tag}: the commit ${commit}: ${problems.join('; ')}`);
  return { commit, checks: [...CHECKS] };
}

/** The version that a manifest declares, or null for a composer.json without one. */
export function manifestVersion(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (path.basename(file) === 'composer.json' && !('version' in data)) return null;
  return data.version ?? null;
}

/** The body of the section `## version` of CHANGELOG.md, without the anchor of the next section. */
export function changelogSection(root, version) {
  const lines = readFileSync(path.join(root, CHANGELOG), 'utf8').split('\n');
  const start = lines.indexOf(`## ${version}`);
  if (start < 0) throw new Stop(`${CHANGELOG}: no section ## ${version}`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length > 0 && (!body.at(-1).trim() || /^<a id="[^"]*"><\/a>$/.test(body.at(-1).trim()))) body.pop();
  while (body.length > 0 && !body[0].trim()) body.shift();
  if (body.length === 0) throw new Stop(`${CHANGELOG}: the section ## ${version} has no entry`);
  return `${body.join('\n')}\n`;
}

/** The anchor of the section `## version`: the id of an `<a id="...">` line above it, or the version without its dots. */
export function changelogAnchor(root, version) {
  const lines = readFileSync(path.join(root, CHANGELOG), 'utf8').split('\n');
  let index = lines.indexOf(`## ${version}`) - 1;
  while (index >= 0 && !lines[index].trim()) index -= 1;
  const explicit = index >= 0 ? /^<a id="([^"]+)"><\/a>$/.exec(lines[index].trim()) : null;
  return explicit ? explicit[1] : version.replaceAll('.', '');
}

/** The URL of CHANGELOG.md at the tag with the anchor; each segment of the tag is encoded, so its slashes stay. */
export const changelogLink = (tag, anchor) => `https://github.com/${REPOSITORY}/blob/${tag.split('/').map(encodeURIComponent).join('/')}/${CHANGELOG}#${anchor}`;

/** The notes of the release of the tag: the section when it fits NOTES_LIMIT, otherwise one line that links it. */
export function releaseNotes(root, tag) {
  const [, version] = parseTag(tag);
  const section = changelogSection(root, version);
  if ([...section].length <= NOTES_LIMIT) return section;
  return `The changes of ${version} are listed in [${CHANGELOG}](${changelogLink(tag, changelogAnchor(root, version))}).\n`;
}

/** Every manifest of the tag declares its version, and CHANGELOG.md has the section of the version. */
export function versions(root, tag) {
  const [directory, version] = parseTag(tag);
  const problems = [];
  if (directory === null) {
    for (const name of MANIFESTS) {
      const declared = manifestVersion(path.join(root, name));
      if (declared !== null && declared !== version) problems.push(`${name}: version ${declared}, the tag ${tag} is ${version}`);
    }
  } else {
    const module = /^module\s+(\S+)\s*$/m.exec(readFileSync(path.join(root, directory, 'go.mod'), 'utf8'))?.[1] ?? null;
    if (module !== GO_MODULES[directory]) problems.push(`${directory}/go.mod: module ${module}, the tag ${tag} is ${GO_MODULES[directory]}`);
  }
  try {
    changelogSection(root, version);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    problems.push(`${error.message} for the tag ${tag}`);
  }
  if (problems.length > 0) throw new Stop(problems.join('; '));
  return version;
}

/** <package name>-<version>.<ext>: `@scope/name` is written `scope-name` and `vendor/name` `vendor-name`. */
export const assetName = (name, version, extension) => `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.${extension}`;

export function assetNames(tag) {
  const [directory, version] = parseTag(tag);
  if (directory !== null) return [];
  return PACKAGES.map(({ kind, name }) => assetName(name, version, EXTENSIONS[kind]));
}

/** Each dependency of a packed manifest that a consumer outside this repository cannot resolve, and a wrong version. */
export function manifestProblems(asset, manifest, version) {
  const problems = [];
  if (asset.endsWith('.zip')) {
    if (manifest.version !== version) problems.push(`${asset}: version is ${manifest.version}, not the release version ${version}`);
    if ('repositories' in manifest) problems.push(`${asset}: repositories is declared; a consumer resolves no repository of a package`);
    for (const field of COMPOSER_FIELDS) {
      for (const [name, constraint] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith('polyspec/') && !EXACT_VERSION.test(constraint)) problems.push(`${asset}: ${field} ${name} is ${constraint}, not an exact released version`);
      }
    }
  } else {
    for (const field of NPM_FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith('@polyspec/') && !EXACT_VERSION.test(spec)) problems.push(`${asset}: ${field} ${name} is ${spec}, not an exact released version`);
      }
    }
  }
  return problems;
}

/** The manifest of each archive: package/package.json of a tarball, composer.json of a zip. */
export function packedManifests(target, names) {
  return Object.fromEntries(names.map((name) => {
    const file = path.join(target, name);
    const text = name.endsWith('.zip') ? run('unzip', ['-p', file, 'composer.json']) : run('tar', ['-xzOf', file, 'package/package.json']);
    return [name, JSON.parse(text)];
  }));
}

/** The manifest of a package as the tree declares it: package.json of the working tree for npm pack, which packs the
 * working tree, and composer.json of the commit for git archive. */
function sourceManifest(root, commit, kind, folder) {
  if (kind === 'npm') return JSON.parse(readFileSync(path.join(root, folder, 'package.json'), 'utf8'));
  return JSON.parse(run('git', ['show', `${commit}:${folder}/composer.json`], { cwd: root }));
}

/** Build the archive of every package at the commit for the tag into target, with the manifests of the tree unchanged;
 * fail for a packed manifest of manifestProblems or one that differs from its source manifest. */
export function buildAssets(root, commit, tag, target) {
  const [, version] = parseTag(tag);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const names = assetNames(tag);
  PACKAGES.forEach(({ kind, directory: folder }, index) => {
    if (kind === 'npm') run('npm', ['pack', '--pack-destination', target], { cwd: path.join(root, folder) });
    else run('git', ['archive', '--format=zip', `--output=${path.join(target, names[index])}`, `${commit}:${folder}`], { cwd: root });
  });
  const present = readdirSync(target).sort();
  if (JSON.stringify(present) !== JSON.stringify([...names].sort())) throw new Stop(`${target} holds [${present.join(', ')}], not the archives [${[...names].sort().join(', ')}]`);
  const packed = packedManifests(target, names);
  const problems = PACKAGES.flatMap(({ kind, directory: folder }, index) => {
    const name = names[index];
    const found = manifestProblems(name, packed[name], version);
    if (!isDeepStrictEqual(packed[name], sourceManifest(root, commit, kind, folder))) found.push(`${name}: the packed manifest differs from ${folder}/${kind === 'npm' ? 'package.json' : 'composer.json'}`);
    return found;
  });
  if (problems.length > 0) throw new Stop(problems.join('; '));
  return names;
}

/** Build the archive of every package of the tag into ASSETS; the names of the archives. */
export function assets(root, tag) {
  const [directory] = parseTag(tag);
  const target = path.join(root, ASSETS);
  if (directory !== null) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    return [];
  }
  return buildAssets(root, taggedCommit(root, tag), tag, target);
}

/** Create the GitHub Release of the tag with the notes of releaseNotes and the archives of assets. */
export function publish(root, tag) {
  const notes = releaseNotes(root, tag);
  const names = assetNames(tag);
  const target = path.join(root, ASSETS);
  const missing = names.filter((name) => !existsSync(path.join(target, name)));
  if (missing.length > 0) throw new Stop(`${ASSETS} lacks [${missing.join(', ')}]; make release-assets builds them`);
  const folder = mkdtempSync(path.join(tmpdir(), 'release-notes-'));
  try {
    const notesFile = path.join(folder, 'notes.md');
    writeFileSync(notesFile, notes);
    run('gh', ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesFile, ...names.map((name) => path.join(target, name))], { cwd: root });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return names;
}

export function main(argv, { root = ROOT, env = process.env, print = console.log, error = console.error } = {}) {
  const [mode, tag, ...rest] = argv;
  if (!['verify', 'versions', 'assets', 'publish'].includes(mode) || !tag || rest.length > 0) {
    error(USAGE);
    return 2;
  }
  try {
    if (mode === 'verify') {
      const { commit, checks } = verify(root, tag, env.GITHUB_REPOSITORY);
      print(`[release] ${tag}: the commit ${commit} is on ${MAIN} and passed ${checks.join(', ')}`);
    } else if (mode === 'versions') {
      const version = versions(root, tag);
      print(`[release] ${tag}: every manifest of the tag declares ${version} and ${CHANGELOG} has ## ${version}`);
    } else if (mode === 'assets') {
      const names = assets(root, tag);
      print(`[release] ${tag}: built ${names.length > 0 ? names.join(', ') : 'no archive (a Go module)'} in ${ASSETS}`);
    } else {
      const names = publish(root, tag);
      print(`[release] ${tag}: created the GitHub Release with ${names.length > 0 ? names.join(', ') : 'no archive'}`);
    }
  } catch (failure) {
    if (!(failure instanceof Stop) && !(failure instanceof SyntaxError) && failure.code === undefined) throw failure;
    error(`[release] ${mode} ${tag} failed: ${failure.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
