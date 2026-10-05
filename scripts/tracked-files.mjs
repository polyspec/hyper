// Copies the files that Git tracks below a path of a repository, as its working tree holds them: a tracked file that
// the working tree deleted is not copied and is returned, so that the caller names it. Every copy keeps the
// modification time of its source, so that a build tool such as cargo builds again only when a source changed, and
// the executable bits.
import { execFileSync } from 'node:child_process';
import { chmodSync, statSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';
import { copyFile } from './output-files.mjs';

// Git runs without the variables that Git sets for its hooks, which would name the repository of the hook.
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].includes(name)));

/** Runs Git in `repository` and returns its standard output. */
export function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', env: gitEnv() });
}

/**
 * Copies the tracked files below `path` of `repository` into `target`, each at its path relative to `base` (a prefix
 * of `path`), and returns { files, deleted } with the copied files and the tracked files that the working tree deleted.
 */
export function copyTracked({ repository, path, target, base = '' }) {
  const deleted = git(repository, 'ls-files', '-d', '-z', '--', path).split('\0').filter(Boolean);
  const files = git(repository, 'ls-files', '-c', '-z', '--', path).split('\0').filter((file) => file !== '' && !deleted.includes(file));
  if (files.length === 0) throw new Error(`${repository} tracks no file below ${path}`);
  for (const file of files) {
    const source = join(repository, file);
    const copy = join(target, relative(base, file));
    copyFile(source, copy);
    const { atimeMs, mtimeMs, mode } = statSync(source);
    utimesSync(copy, atimeMs / 1000, mtimeMs / 1000);
    if (mode & 0o111) chmodSync(copy, 0o755);
  }
  return { files, deleted };
}
