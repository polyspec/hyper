#!/usr/bin/env node
// Chooses the PHP that make install-tools wraps for the checkout (H35.137, HR-81).
//
//   node scripts/php-wrappers.mts path <minor> [--prefix=<directory>]...
//
// Prints the absolute path of the php of the minor release <minor>, which .php-version names, found under the Homebrew
// prefixes `/opt/homebrew` and `/usr/local` (or the given --prefix directories) as `opt/php@<minor>/bin/php`. A candidate
// is chosen only when its own version query reports exactly <minor>. The order of PATH plays no part in the choice, so a
// PHP of another minor release first on PATH is never wrapped. Exits 1 with the candidates it searched when none matches,
// and exits 2 for a usage error. Kit's install-tools receives the printed path as --php and writes the wrappers from it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_PREFIXES = ['/opt/homebrew', '/usr/local'];
const VERSION_QUERY = 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;';

/** Returns the php of the minor release, or undefined when no candidate of a prefix reports that minor release. */
function findPhp(minor: string, prefixes: string[]): { found?: string; searched: string[] } {
  const searched: string[] = [];
  for (const prefix of prefixes) {
    const candidate = path.join(prefix, 'opt', `php@${minor}`, 'bin/php');
    searched.push(candidate);
    if (!existsSync(candidate)) continue;
    const query = spawnSync(candidate, ['-n', '-r', VERSION_QUERY], { encoding: 'utf8' });
    if (query.status === 0 && query.stdout.trim() === minor) return { found: candidate, searched };
  }
  return { searched };
}

const [command, minor, ...options] = process.argv.slice(2);
const prefixes = options.filter((option) => option.startsWith('--prefix=')).map((option) => option.slice('--prefix='.length));
const unknown = options.filter((option) => !option.startsWith('--prefix='));

if (command !== 'path' || minor === undefined || !/^\d+\.\d+$/u.test(minor) || unknown.length > 0) {
  process.stderr.write('usage: node scripts/php-wrappers.mts path <minor> [--prefix=<directory>]...\n');
  process.exit(2);
}

const result = findPhp(minor, prefixes.length > 0 ? prefixes : DEFAULT_PREFIXES);
if (result.found === undefined) {
  process.stderr.write(`php-wrappers: no php of PHP ${minor} exists; searched ${result.searched.join(', ')}. `
    + `Install it (Homebrew: brew install php@${minor}) and run make install-tools again.\n`);
  process.exit(1);
}
process.stdout.write(`${result.found}\n`);
