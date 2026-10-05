// Copies the output files of the build scripts (HY-68). Every file is created with the mode 0644
// and written with the bytes of its source, and every directory with the mode 0755. `fs.cpSync`
// of Node creates its destination files with the mode 0200, which a virtiofs bind mount of a
// Linux container refuses with EACCES.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;

/**
 * Writes `content` to `file` with the mode 0644: the bytes go to a file of this process next to it, which then
 * replaces `file` with one rename, so a reader finds the previous or the new content and never a partial file
 * (HY-82).
 */
export function writeFileAtomic(file, content) {
  mkdirSync(dirname(file), { recursive: true, mode: DIRECTORY_MODE });
  const next = `${file}.next-${process.pid}`;
  writeFileSync(next, content, { mode: FILE_MODE });
  renameSync(next, file);
}

/** Copies the file `source` to `target` and creates the directories of `target`. */
export function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true, mode: DIRECTORY_MODE });
  writeFileSync(target, readFileSync(source), { mode: FILE_MODE });
}

/** Copies every file and directory below `source` to `target`; another entry kind fails. */
export function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true, mode: DIRECTORY_MODE });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFile(from, to);
    else throw new Error(`cannot copy ${from}: it is not a file or a directory`);
  }
}
