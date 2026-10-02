// Copies the output files of the build scripts (HY-68). Every file is created with the mode 0644
// and written with the bytes of its source, and every directory with the mode 0755. `fs.cpSync`
// of Node creates its destination files with the mode 0200, which a virtiofs bind mount of a
// Linux container refuses with EACCES.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;

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
