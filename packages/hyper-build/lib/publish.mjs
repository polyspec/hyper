// Publishes outputs that other processes read while they are written again (HY-82). An output is written completely
// into a staging directory of its own process (`<target>.next-<pid>`) next to its target; each file then moves into
// the target with rename(2), which replaces a path in one step on one file system, the files of `last` after all
// others, and then the files and directories of the target that the new output does not have are removed. A reader
// finds the previous or the new version of every file and never a missing file. Limit: a reader that reads several
// files while the output changes can combine files of the two versions; two writers of the same inputs write the
// same files.
import { mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';

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
