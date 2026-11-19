#!/usr/bin/env node
// Chooses the PHP that make install-tools wraps for the checkout (H35.137, H35.153, HR-81).
//
//   node scripts/php-wrappers.mts path <minor> [--if-present] [--prefix=<directory>]...
//
// Prints the absolute path of the php of the minor release <minor>, which .php-version names. The candidates are, in
// order, `opt/php@<minor>/bin/php` under the Homebrew prefixes `/opt/homebrew` and `/usr/local` (or the given --prefix
// directories), and then the `php` of each directory of PATH, which is where a machine without Homebrew, such as a CI
// runner whose setup step installs PHP, has it (H35.153). A candidate is chosen only when its own version query reports
// exactly <minor>, so a PHP of another minor release first on PATH is passed over and never wrapped (H35.137). When none
// matches, the script exits 1 with the candidates it searched; with --if-present it prints nothing and exits 0, so that
// install-tools installs the tools of a group that runs no PHP. It exits 2 for a usage error. Kit's install-tools
// receives the printed path as --php and writes the wrappers from it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_PREFIXES = ['/opt/homebrew', '/usr/local'];
const VERSION_QUERY = 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;';

/** The candidates in their order: the php of the minor release under each prefix, then the php of each directory of PATH. */
function candidates(minor: string, prefixes: string[]): string[] {
  const underPrefixes = prefixes.map((prefix) => path.join(prefix, 'opt', `php@${minor}`, 'bin/php'));
  const onPath = (process.env.PATH ?? '').split(path.delimiter).filter((directory) => path.isAbsolute(directory))
    .map((directory) => path.join(directory, 'php'));
  return [...new Set([...underPrefixes, ...onPath])];
}

/** Returns the php of the minor release, or undefined when no candidate reports that minor release. */
function findPhp(minor: string, prefixes: string[]): { found?: string; searched: string[] } {
  const searched: string[] = [];
  for (const candidate of candidates(minor, prefixes)) {
    searched.push(candidate);
    if (!existsSync(candidate)) continue;
    const query = spawnSync(candidate, ['-n', '-r', VERSION_QUERY], { encoding: 'utf8' });
    if (query.status === 0 && query.stdout.trim() === minor) return { found: candidate, searched };
  }
  return { searched };
}

const [command, minor, ...options] = process.argv.slice(2);
const prefixes = options.filter((option) => option.startsWith('--prefix=')).map((option) => option.slice('--prefix='.length));
const ifPresent = options.includes('--if-present');
const unknown = options.filter((option) => !option.startsWith('--prefix=') && option !== '--if-present');

if (command !== 'path' || minor === undefined || !/^\d+\.\d+$/u.test(minor) || unknown.length > 0) {
  process.stderr.write('usage: node scripts/php-wrappers.mts path <minor> [--if-present] [--prefix=<directory>]...\n');
  process.exit(2);
}

const result = findPhp(minor, prefixes.length > 0 ? prefixes : DEFAULT_PREFIXES);
if (result.found === undefined && ifPresent) process.exit(0);
if (result.found === undefined) {
  process.stderr.write(`php-wrappers: no php of PHP ${minor} exists; searched ${result.searched.join(', ')}. `
    + `Install it (Homebrew: brew install php@${minor}) and run make install-tools again.\n`);
  process.exit(1);
}
process.stdout.write(`${result.found}\n`);
