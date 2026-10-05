#!/usr/bin/env node
// Publishes outputs that other processes read while they are written again (HY-82). An output is written completely
// into a staging directory of its own process (`<target>.next-<pid>`) next to its target; each file then moves into
// the target with rename(2), which replaces a path in one step on one file system, the files of `last` after all
// others, and then the files and directories of the target that the new output does not have are removed. A reader
// finds the previous or the new version of every file and never a missing file. Limit: a reader that reads several
// files while the output changes can combine files of the two versions; two writers of the same inputs write the
// same files.
//
// The installed copies of the packages of this repository and of the template copy are published the same way:
//
//   node scripts/publish.mjs npm-copy <package directory> <node_modules/<name>>
//       packs the package with npm (its `files`) and publishes the packed files into the npm copy
//   node scripts/publish.mjs composer-copy <package directory> <vendor/<vendor>/<name>>
//       publishes the files of the package directory into the Composer copy, as the path repository mirrors it
//   node scripts/publish.mjs directory <staging directory> <target>
//       publishes a staging directory that a build wrote, such as the dist of an npm package
//
// A copy is published only while the package manager would install the same dependency tree: when the dependencies
// (npm) or the requirements and the autoload rules (Composer) of the package differ from the installed copy, the
// command fails, names the expected and the actual value, and names the install command that applies the change.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The files below `directory`, relative and sorted. */
export function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** The staging directory of this process next to `target`. */
export const staging = (target) => `${path.resolve(target)}.next-${process.pid}`;

/**
 * Moves every file of `staged` into `target` with one rename each, the files named in `last` after the others,
 * removes the files and empty directories of `target` that `staged` does not have, and removes `staged`.
 */
export function publish(staged, target, { last = [] } = {}) {
  mkdirSync(target, { recursive: true });
  const incoming = files(staged);
  const order = [...incoming.filter((file) => !last.includes(file)), ...last.filter((file) => incoming.includes(file))];
  for (const file of order) {
    const destination = path.join(target, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(path.join(staged, file), destination);
  }
  const keep = new Set(incoming);
  const stale = files(target).filter((file) => !keep.has(file));
  for (const file of stale) unlinkSync(path.join(target, file));
  // Directories that held only stale files, deepest first.
  const directories = readdirSync(target, { recursive: true, withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name)).sort((a, b) => b.length - a.length);
  for (const directory of directories) if (readdirSync(directory).length === 0) rmdirSync(directory);
  rmSync(staged, { recursive: true, force: true });
  return { files: incoming.length, removed: stale };
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Fails when a field of the manifest of the package differs from the installed copy, naming both and the command.
function requireSameTree(source, target, manifest, fields, command) {
  const installed = path.join(target, manifest);
  if (!existsSync(installed)) throw new Error(`${target} is not installed; run \`${command}\``);
  const expected = readJson(path.join(source, manifest));
  const actual = readJson(installed);
  for (const field of fields) {
    if (!same(expected[field], actual[field])) {
      throw new Error(`${field} of ${path.join(source, manifest)} is ${JSON.stringify(expected[field] ?? null)}, the installed ${installed} has ${JSON.stringify(actual[field] ?? null)}; run \`${command}\``);
    }
  }
}

export function npmCopy(source, target) {
  requireSameTree(source, target, 'package.json', ['name', 'dependencies', 'peerDependencies', 'optionalDependencies', 'bin'], 'npm install');
  const scratch = mkdtempSync(`${path.resolve(target)}.pack-`);
  try {
    execFileSync('npm', ['pack', '--ignore-scripts', '--loglevel=warn', '--pack-destination', scratch], { cwd: source, stdio: ['ignore', 'ignore', 'inherit'] });
    const archives = readdirSync(scratch);
    if (archives.length !== 1 || !archives[0].endsWith('.tgz')) throw new Error(`npm pack of ${source} wrote ${JSON.stringify(archives)}, expected one .tgz file`);
    const staged = staging(target);
    rmSync(staged, { recursive: true, force: true });
    mkdirSync(staged, { recursive: true });
    execFileSync('tar', ['-x', '-f', path.join(scratch, archives[0]), '-C', staged, '--strip-components', '1']);
    return publish(staged, target, { last: ['package.json'] });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function composerCopy(source, target) {
  requireSameTree(source, target, 'composer.json', ['name', 'require', 'autoload'], `composer reinstall ${readJson(path.join(source, 'composer.json')).name} --working-dir=<the project of ${target}>`);
  const staged = staging(target);
  rmSync(staged, { recursive: true, force: true });
  // The path repository mirrors the files with their modes, such as the executable bits of bin/.
  for (const file of files(source)) {
    mkdirSync(path.dirname(path.join(staged, file)), { recursive: true });
    copyFileSync(path.join(source, file), path.join(staged, file));
    chmodSync(path.join(staged, file), statSync(path.join(source, file)).mode & 0o777);
  }
  // Composer makes the binaries of the package executable.
  for (const file of readJson(path.join(source, 'composer.json')).bin ?? []) chmodSync(path.join(staged, file), 0o755);
  return publish(staged, target, { last: ['composer.json'] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, source, target] = process.argv.slice(2);
  try {
    if (!source || !target) throw new Error('Usage: node scripts/publish.mjs npm-copy|composer-copy|directory <source> <target>');
    const result = action === 'npm-copy' ? npmCopy(source, target)
      : action === 'composer-copy' ? composerCopy(source, target)
        : action === 'directory' ? publish(source, target)
          : null;
    if (result === null) throw new Error(`unknown action ${action}; expected npm-copy, composer-copy or directory`);
    console.log(`publish: ${source} -> ${target} (${result.files} files${result.removed.length > 0 ? `; removed ${result.removed.join(' ')}` : ''})`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
