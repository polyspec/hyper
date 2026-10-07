// Writes the declared copy of the template repository that this repository reads for the native extension (HY-78):
// `make ext` and PHPStan read the copy and never the checkout of the template repository, whose working tree another
// process may change at any time. npm and Composer install the template packages from the assets of the template
// release (HY-70) and read nothing of the copy.
//
// The copy is the commit of the tag `--tag` (TEMPLATE_TAG of the Makefile) of the checkout of the template repository
// (HY-80), whatever commit its working tree or any of its branches is at; a missing tag fails the copy. The copy has the
// layout of the template repository and holds:
//   packages/template-php-ext/src  the C sources and the stub of the native extension
//   scripts                        the build of the native extension, build-php-extension.mjs, and the scripts it imports
//   copy.json                      the tag, its commit and the hash of this script
// Every path is taken from the commit of the tag with `git archive`, so its files and their modification times (the
// commit time) are the same on every machine. When copy.json of the output already names the same tag, commit and
// script hash, the copy writes nothing. Otherwise the copy is written into a staging directory of this process and
// published file by file, copy.json last (packages/hyper-build/lib/publish.mjs, HY-82), so a reader never finds a file
// missing. This script builds nothing in the template repository.
//
// Usage: node scripts/copy-template.mjs --repository ../template --tag v0.0.4 --output var/products/template
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publish, staging } from '../packages/hyper-build/lib/publish.mjs';

const TRACKED = [
  'packages/template-php-ext/src',
  'scripts/build-php-extension.mjs', 'scripts/publish-build.mjs', 'scripts/temporary-workspace.mjs', 'scripts/test-progress/step.mjs',
];

const { values } = parseArgs({ options: { repository: { type: 'string' }, tag: { type: 'string' }, output: { type: 'string' } } });
if (!values.repository || !values.tag || !values.output) throw new Error('--repository, --tag and --output are required');
const repository = resolve(values.repository);
const output = resolve(values.output);
const next = staging(output);

const tag = values.tag;
const resolved = spawnSync('git', ['-C', repository, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
if (resolved.status !== 0) {
  const tags = spawnSync('git', ['-C', repository, 'tag', '--list'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  throw new Error(`${repository} has no tag ${tag}: expected the tag ${tag}, actual tags ${tags.length > 0 ? tags.join(', ') : 'none'}; fetch the tags of the template repository with \`git -C ${values.repository} fetch --tags\``);
}
const commit = resolved.stdout.trim();
console.log(`template copy: the tag ${tag} of ${repository} at ${commit} -> ${output}`);

const script = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const description = `${JSON.stringify({ tag, commit, script }, null, 2)}\n`;
const recorded = join(output, 'copy.json');
if (existsSync(recorded) && readFileSync(recorded, 'utf8') === description) {
  console.log(`template copy: ${output} holds the commit ${commit} of the tag ${tag}; nothing to copy`);
  process.exit(0);
}

rmSync(next, { recursive: true, force: true });
mkdirSync(next, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'hyper-template-copy-'));
try {
  // The tracked paths, as the commit of the tag holds them.
  const archive = join(scratch, 'tracked.tar');
  execFileSync('git', ['-C', repository, 'archive', '--format=tar', `--output=${archive}`, commit, '--', ...TRACKED]);
  execFileSync('tar', ['-x', '-f', archive, '-C', next]);
  const missing = TRACKED.filter((path) => !existsSync(join(next, path)));
  if (missing.length > 0) throw new Error(`the commit ${commit} of the tag ${tag} of ${repository} has no ${missing.join(', ')}`);
  console.log(`template copy: extracted ${TRACKED.join(', ')} of ${commit}`);
} catch (error) {
  rmSync(next, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(next, 'copy.json'), description);

// Every file moves into the copy with a rename, copy.json last, so a reader of the copy never finds a file missing
// (HY-82).
const published = publish(next, output, { last: ['copy.json'] });
console.log(`template copy: wrote ${output} (${published.files} files${published.removed.length > 0 ? `; removed ${published.removed.length}` : ''})`);
