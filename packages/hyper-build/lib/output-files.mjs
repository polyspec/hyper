// Copies the output files of the build scripts (HY-68). Every file gets the mode 0644 and the bytes of its source, and
// every directory that a copy creates the mode 0755, whatever the umask of the process: the mode of a creation is
// reduced by the umask, so each file and created directory is set to its mode after its creation, and a process of
// another user can read it. A file is never created with a mode that its owner cannot read: `fs.cpSync` of Node creates
// its destination files with the mode 0200, which a virtiofs bind mount of a Linux container refuses with EACCES.
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;

/** Creates `directory` and its missing parents with the mode 0755, whatever the umask. */
function makeDirectory(directory) {
  const first = mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  if (first === undefined) return;
  // mkdirSync returns the first directory that it created; it and the directories below it up to `directory` are new.
  for (let current = directory; ; current = dirname(current)) {
    chmodSync(current, DIRECTORY_MODE);
    if (current === first) break;
  }
}

/** Writes `content` to `file` and gives it the mode 0644, whatever the umask and an earlier mode of the file. */
function writeFile(file, content) {
  writeFileSync(file, content, { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
}

/**
 * Writes `content` to `file` with the mode 0644: the bytes go to a file of this process next to it, which then
 * replaces `file` with one rename, so a reader finds the previous or the new content and never a partial file
 * (HY-82).
 */
export function writeFileAtomic(file, content) {
  makeDirectory(dirname(file));
  const next = `${file}.next-${process.pid}`;
  writeFile(next, content);
  renameSync(next, file);
}

/** Copies the file `source` to `target` and creates the directories of `target`. */
export function copyFile(source, target) {
  makeDirectory(dirname(target));
  writeFile(target, readFileSync(source));
}

/** Copies every file and directory below `source` to `target`; another entry kind fails. */
export function copyDirectory(source, target) {
  makeDirectory(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFile(from, to);
    else throw new Error(`cannot copy ${from}: it is not a file or a directory`);
  }
}
