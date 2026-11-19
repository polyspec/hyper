// The documents of the repository for the tests that read them: the tracked files that the `include` globs of
// config/documents.json select, read from the working directory of the test run, which is the root of the checkout.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

/** The tracked files, and the predicate of the files that the include globs of config/documents.json select. */
export function trackedDocuments(): { tracked: string[]; selected: (file: string) => boolean } {
  const config: unknown = JSON.parse(readFileSync('config/documents.json', 'utf8'));
  if (typeof config !== 'object' || config === null || !('include' in config) || !Array.isArray(config.include)) {
    throw new Error('config/documents.json has no list include');
  }
  const globs = config.include.filter((glob: unknown): glob is string => typeof glob === 'string');
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  return { tracked, selected: (file) => globs.some((glob) => matchesGlob(file, glob)) };
}
