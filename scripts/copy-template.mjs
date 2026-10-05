// Writes the declared copy of the template repository that this repository reads (HY-78): the build scripts
// (`--template-dir`), npm, Composer, PHPStan and the native extension build read the copy and never the checkout of
// the template repository, whose builds another process may write again at any time.
//
// The copy is the commit at the head of the branch that config/template.json names (HY-80), whatever commit the
// working tree of the template repository is at; a missing branch fails the copy. The copy has the layout of the template repository and holds:
//   packages/template-ts       the files that `npm pack` packs from the built TypeScript package, without its scripts
//   packages/template-php      the PHP package
//   packages/template-php-ext  the native extension and the Rust crate packages/template-rust that it builds from
//   packages/template-rust
//   tools/compiler             the compiler of the generated programs and contracts/functions.json that it reads
//   rust-toolchain.toml        the Rust toolchain of the template repository, with which `make ext` builds (HY-81)
//   copy.json                  the head commit and the input hash of the TypeScript build
// Every path except packages/template-ts is taken from the head commit with `git archive`, so its files and their
// modification times (the commit time) are the same on every machine, and cargo builds the extension again only when
// config/template.json changes. The TypeScript package is a build output of the template repository: its record
// `packages/template-ts/dist.inputs.json` names the hash of the inputs of the build (scripts/build-package.mjs of the
// template repository). The copy requires that the inputs are the files of the head commit, that the hash of their
// contents in that commit equals the recorded hash, and that the record and the packed build files did not change
// while npm packed them; each mismatch fails the copy and names the expected and the actual value. The copy takes the packed
// file from an empty pack directory and does not parse the output of npm, whose format differs between npm versions.
// The copy is written into a staging directory of this process and published file by file (scripts/publish.mjs,
// HY-82), so a reader never finds a file missing. This script builds nothing in the template repository.
//
// Usage: node scripts/copy-template.mjs --repository ../template --config config/template.json --output var/products/template
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { publish, staging } from './publish.mjs';
import { NPM } from './toolchain.mjs';
import { git } from './tracked-files.mjs';

const TRACKED = ['packages/template-php', 'packages/template-php-ext', 'packages/template-rust', 'tools/compiler', 'contracts/functions.json', 'rust-toolchain.toml'];
const TYPESCRIPT = 'packages/template-ts';
const RECORD = `${TYPESCRIPT}/dist.inputs.json`;

const { values } = parseArgs({ options: { repository: { type: 'string' }, config: { type: 'string' }, output: { type: 'string' } } });
if (!values.repository || !values.config || !values.output) throw new Error('--repository, --config and --output are required');
const repository = resolve(values.repository);
const output = resolve(values.output);
const next = staging(output);

const branch = JSON.parse(readFileSync(values.config, 'utf8')).branch;
if (typeof branch !== 'string' || branch === '') {
  throw new Error(`${values.config} names no branch: expected "branch", actual ${JSON.stringify(branch)}`);
}
const resolved = spawnSync('git', ['-C', repository, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { encoding: 'utf8' });
if (resolved.status !== 0) {
  throw new Error(`${repository} has no branch ${branch}, which ${values.config} names; check out the template repository with its branch ${branch}`);
}
const commit = resolved.stdout.trim();
console.log(`template copy: the commit ${commit} of ${repository} -> ${output}`);

// The TypeScript package: its build must be the build of the inputs of the head commit, whatever commit the
// checkout of the template repository is at.
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
const headFiles = new Set(git(repository, 'ls-tree', '-r', '--name-only', commit, '--', ...inputs, `${TYPESCRIPT}/src`).split('\n').filter(Boolean));
const absent = inputs.filter((file) => !headFiles.has(file));
const unlisted = [...headFiles].filter((file) => !inputs.includes(file));
if (absent.length > 0 || unlisted.length > 0) {
  throw new Error(`the inputs of the build of ${TYPESCRIPT} differ from the head commit ${commit}: ${[...absent.map((file) => `${file} is not in the commit`), ...unlisted.map((file) => `${file} of the commit is not an input`)].join('; ')}; build the head commit in the template repository or change the branch`);
}
const hash = createHash('sha256');
for (const file of inputs) hash.update(`${file}\0`).update(execFileSync('git', ['-C', repository, 'show', `${commit}:${file}`], { maxBuffer: 1 << 28 })).update('\0');
hash.update(process.version);
const actual = hash.digest('hex');
if (record.hash !== actual) {
  throw new Error(`${RECORD} records a build of the inputs ${record.hash}, expected the inputs ${actual} of the head commit ${commit} with Node.js ${process.version}; build the head commit in the template repository with \`make build-ts\` or change the branch`);
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

  // The tracked paths, as the head commit holds them.
  const archive = join(scratch, 'tracked.tar');
  execFileSync('git', ['-C', repository, 'archive', '--format=tar', `--output=${archive}`, commit, '--', ...TRACKED]);
  execFileSync('tar', ['-x', '-f', archive, '-C', next]);
  const missing = TRACKED.filter((path) => !existsSync(join(next, path)));
  if (missing.length > 0) throw new Error(`the head commit ${commit} of ${repository} has no ${missing.join(', ')}`);
  console.log(`template copy: extracted ${TRACKED.join(', ')} of ${commit}`);
} catch (error) {
  rmSync(next, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(next, 'copy.json'), `${JSON.stringify({ commit, inputs: actual }, null, 2)}\n`);

// Every file moves into the copy with a rename, copy.json last, so a reader of the copy never finds a file missing
// (HY-82).
const published = publish(next, output, { last: ['copy.json'] });
console.log(`template copy: wrote ${output} (${published.files} files${published.removed.length > 0 ? `; removed ${published.removed.length}` : ''})`);
