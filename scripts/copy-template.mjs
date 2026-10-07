// Writes the declared copy of the template repository that this repository reads (HY-78): the build scripts
// (`--template-dir`), npm, Composer, PHPStan and the native extension build read the copy and never the checkout of
// the template repository, whose builds another process may write again at any time.
//
// The copy is the commit of the tag `--tag` (TEMPLATE_TAG of the Makefile) of the checkout of the template repository
// (HY-80), whatever commit its working tree or any of its branches is at; a missing tag fails the copy. The copy has the
// layout of the template repository and holds:
//   packages/template-ts       the files that `npm pack` packs from the built TypeScript package, without its scripts,
//                              and its sources and build configuration, whose digest the compiler records
//   packages/template-php      the PHP package
//   packages/template-php-ext  the C sources and the stub of the native extension
//   tools/compiler             the compiler of the generated programs and contracts/functions.json that it reads
//   package-lock.json          the lock of the TypeScript build, which the digest of the compiler reads
//   scripts                    the build of the native extension, build-php-extension.mjs, and the scripts it imports
//   copy.json                  the tag, its commit, the input hash of the TypeScript build and the hash of this script
// Every path except the packed files of packages/template-ts is taken from the commit of the tag with `git archive`,
// so its files and their modification times (the commit time) are the same on every machine. The TypeScript package is a build output of the template repository: its record
// `packages/template-ts/dist.inputs.json` names the hash of the inputs of the build (scripts/build-package.mjs of the
// template repository). The copy requires that the inputs are the files of the commit of the tag, that the hash of
// their contents in that commit equals the recorded hash, and that the record and the packed build files did not change
// while npm packed them; each mismatch fails the copy and names the expected and the actual value. The copy takes the
// packed file from an empty pack directory and does not parse the output of npm, whose format differs between npm
// versions. When copy.json of the output already names the same tag, commit, input hash and script hash, the copy
// writes nothing, so the modification time of copy.json changes only with a new copy and `make template` installs the
// packages again only then. Otherwise the copy is written into a staging directory of this process and published file
// by file, copy.json last (scripts/publish.mjs, HY-82), so a reader never finds a file missing. This script builds
// nothing in the template repository.
//
// Usage: node scripts/copy-template.mjs --repository ../template --tag v0.0.2 --output var/products/template
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publish, staging } from './publish.mjs';
import { NPM } from './toolchain.mjs';
import { git } from './tracked-files.mjs';

const TRACKED = [
  'packages/template-php', 'packages/template-php-ext/src', 'tools/compiler', 'contracts/functions.json', 'package-lock.json',
  'packages/template-ts/src', 'packages/template-ts/tsconfig.json', 'packages/template-ts/tsup.config.ts',
  'scripts/build-php-extension.mjs', 'scripts/publish-build.mjs', 'scripts/temporary-workspace.mjs', 'scripts/test-progress/step.mjs',
];
const TYPESCRIPT = 'packages/template-ts';
const RECORD = `${TYPESCRIPT}/dist.inputs.json`;

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

// The TypeScript package: its build must be the build of the inputs of the commit of the tag, whatever commit the
// working tree of the template repository is at.
const typescript = join(repository, TYPESCRIPT);
const readRecord = () => {
  if (!existsSync(join(repository, RECORD))) throw new Error(`${typescript} has no build: ${RECORD} is missing; build it in the template repository with \`make build-ts\``);
  return readFileSync(join(repository, RECORD), 'utf8');
};
const recordText = readRecord();
const record = JSON.parse(recordText);
const inputs = execFileSync(process.execPath, [join(repository, 'scripts/build-package.mjs'), '--package', 'template-ts', '--print-inputs'], { cwd: repository, encoding: 'utf8' })
  .split('\n').filter(Boolean);
if (inputs.length === 0) throw new Error(`scripts/build-package.mjs of ${repository} printed no inputs of template-ts`);
const listed = new Set(git(repository, 'ls-tree', '-r', '--name-only', commit, '--', ...inputs, `${TYPESCRIPT}/src`).split('\n').filter(Boolean));
const absent = inputs.filter((file) => !listed.has(file));
const unlisted = [...listed].filter((file) => !inputs.includes(file));
if (absent.length > 0 || unlisted.length > 0) {
  throw new Error(`the inputs of the build of ${TYPESCRIPT} differ from the commit ${commit} of the tag ${tag}: ${[...absent.map((file) => `${file} is not in the commit`), ...unlisted.map((file) => `${file} of the commit is not an input`)].join('; ')}; check out the tag ${tag} in the template repository and build it with \`make build-ts\``);
}
const hash = createHash('sha256');
for (const file of inputs) hash.update(`${file}\0`).update(execFileSync('git', ['-C', repository, 'show', `${commit}:${file}`], { maxBuffer: 1 << 28 })).update('\0');
hash.update(process.version);
const actual = hash.digest('hex');
if (record.hash !== actual) {
  throw new Error(`${RECORD} records a build of the inputs ${record.hash}, expected the inputs ${actual} of the commit ${commit} of the tag ${tag} with Node.js ${process.version}; check out the tag ${tag} in the template repository and build it with \`make build-ts\``);
}

const script = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const description = `${JSON.stringify({ tag, commit, inputs: actual, script }, null, 2)}\n`;
const recorded = join(output, 'copy.json');
if (existsSync(recorded) && readFileSync(recorded, 'utf8') === description) {
  console.log(`template copy: ${output} holds the commit ${commit} of the tag ${tag}; nothing to copy`);
  process.exit(0);
}

const listFiles = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath, entry.name))).sort();

rmSync(next, { recursive: true, force: true });
const scratch = mkdtempSync(join(tmpdir(), 'hyper-template-pack-'));
try {
  const packed = join(scratch, 'pack');
  mkdirSync(packed);
  execFileSync(NPM, ['pack', '--ignore-scripts', '--loglevel=warn', '--pack-destination', packed], { cwd: typescript, stdio: ['ignore', 'ignore', 'inherit'] });
  const archives = readdirSync(packed);
  if (archives.length !== 1 || !archives[0].endsWith('.tgz')) throw new Error(`npm pack of ${typescript} wrote ${JSON.stringify(archives)}, expected one .tgz file`);
  const target = join(next, TYPESCRIPT);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-x', '-f', join(packed, archives[0]), '-C', target, '--strip-components', '1']);
  if (readRecord() !== recordText) throw new Error(`${RECORD} changed while npm packed ${TYPESCRIPT}: the template repository published another build; copy again`);
  const files = existsSync(join(target, 'dist')) ? listFiles(join(target, 'dist')) : [];
  const expected = [...record.files].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error(`the packed ${TYPESCRIPT}/dist holds ${JSON.stringify(files)}, expected the files ${JSON.stringify(expected)} of ${RECORD}`);
  }
  console.log(`template copy: packed ${TYPESCRIPT} (${files.length} build files, inputs ${actual.slice(0, 12)})`);

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
