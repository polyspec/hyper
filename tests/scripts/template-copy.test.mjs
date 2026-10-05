// Tests that this repository reads the template repository only through its declared copy (HY-78) of the commit
// at the head of the branch that config/template.json names (HY-80): the copy script copies it whatever commit the template
// checkout is at, fails with the expected and the actual value for a missing branch and a build of other inputs, writes nothing into the
// template repository, and the
// Makefile copies again only when config/template.json changes; npm installs the TypeScript package as a copy inside this
// checkout, and Composer, PHPStan and the native extension build read the copy.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mjs';

const repository = resolve('.');
const COPY = join(repository, 'var', 'products', 'template');
const INPUTS = ['packages/template-ts/package.json', 'packages/template-ts/src/index.ts'];

// The hash of the inputs of a TypeScript build, as scripts/build-package.mjs of the template repository records it.
function inputsHash(directory) {
  const hash = createHash('sha256');
  for (const file of INPUTS) hash.update(`${file}\0`).update(readFileSync(join(directory, file))).update('\0');
  hash.update(process.version);
  return hash.digest('hex');
}

// A template repository with one tracked file in every copied path, a build script that prints the inputs of the
// TypeScript build, and an untracked build of the TypeScript package with its inputs record.
function templateRepository(t, withBuild) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    '.gitignore': 'dist/\ndist.inputs.json\n',
    'scripts/build-package.mjs': `process.stdout.write(${JSON.stringify(INPUTS.join('\n'))} + '\\n');\n`,
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1', type: 'module', files: ['dist'], exports: { '.': { import: './dist/index.mjs' } } }),
    'packages/template-ts/src/index.ts': 'export const built = true;\n',
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    'packages/template-php/bin/template.php': '<?php\n',
    'packages/template-php-ext/Cargo.toml': '[package]\n',
    'packages/template-rust/Cargo.toml': '[package]\n',
    'tools/compiler/compiler.mjs': 'export {};\n',
    'contracts/functions.json': '{}\n',
    'rust-toolchain.toml': '[toolchain]\nchannel = "1.98.1"\nprofile = "minimal"\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text, { mode: path.endsWith('template.php') ? 0o755 : 0o644 });
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (withBuild) build(directory);
  const config = join(directory, '..', `${directory.split('/').pop()}.template.json`);
  t.after(() => rmSync(config, { force: true }));
  const declareCommit = (commit) => {
    git('update-ref', 'refs/heads/declared', commit);
    writeFileSync(config, `${JSON.stringify({ branch: 'declared' })}\n`);
  };
  declareCommit(git('rev-parse', 'HEAD').trim());
  return { directory, git, config, declareCommit, status: () => git('status', '--porcelain', '--ignored') };
}

// Builds the TypeScript package of a fixture repository and records the hash of its inputs.
function build(directory) {
  mkdirSync(join(directory, 'packages/template-ts/dist'), { recursive: true });
  writeFileSync(join(directory, 'packages/template-ts/dist/index.mjs'), 'export const built = true;\n');
  writeFileSync(join(directory, 'packages/template-ts/dist.inputs.json'), `${JSON.stringify({ hash: inputsHash(directory), files: ['index.mjs'] })}\n`);
}

function output(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-copy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'template');
}

const copy = (template, to) => spawnSync(process.execPath, [join(repository, 'scripts', 'copy-template.mjs'), '--repository', template.directory, '--config', template.config, '--output', to], { encoding: 'utf8' });

test('the copy holds the packed TypeScript package and the tracked paths of the head commit and writes nothing into the template repository', (t) => {
  const template = templateRepository(t, true);
  // A change of the working tree that is not committed is not part of the copy.
  writeFileSync(join(template.directory, 'tools/compiler/compiler.mjs'), 'export const changed = true;\n');
  const before = template.status();
  const to = output(t);
  const result = copy(template, to);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(template.status(), before);
  assert.equal(readFileSync(join(to, 'packages/template-ts/dist/index.mjs'), 'utf8'), 'export const built = true;\n');
  assert.equal(readFileSync(join(to, 'tools/compiler/compiler.mjs'), 'utf8'), 'export {};\n');
  const committed = Number(template.git('log', '-1', '--format=%ct').trim());
  for (const path of ['packages/template-php/composer.json', 'packages/template-php-ext/Cargo.toml', 'packages/template-rust/Cargo.toml', 'tools/compiler/compiler.mjs', 'contracts/functions.json']) {
    assert.ok(existsSync(join(to, path)), path);
    // The modification time is the commit time, the same on every machine.
    assert.equal(Math.floor(statSync(join(to, path)).mtimeMs / 1000), committed, path);
  }
  assert.equal(statSync(join(to, 'packages/template-php/bin/template.php')).mode & 0o111, 0o111);
  // The native extension builds in the copy with the Rust toolchain of the template repository (HY-81).
  assert.equal(readFileSync(join(to, 'rust-toolchain.toml'), 'utf8'), '[toolchain]\nchannel = "1.98.1"\nprofile = "minimal"\n');
  // rustc -vV prints its release as a key and value line, the stable form of the pinned compiler (HY-83).
  const rust = spawnSync('rustc', ['-vV'], { cwd: join(to, 'packages/template-php-ext'), encoding: 'utf8', env: { ...process.env, RUSTUP_AUTO_INSTALL: '0' } });
  assert.match(rust.stdout, /^release: 1\.98\.1$/m, `${rust.stdout}${rust.stderr}`);
  assert.deepEqual(JSON.parse(readFileSync(join(to, 'copy.json'), 'utf8')), { commit: template.git('rev-parse', 'HEAD').trim(), inputs: inputsHash(template.directory) });
  assert.equal(existsSync(`${to}.next`), false);
});

test('the copy fails without a build of the TypeScript package and names the build command', (t) => {
  const template = templateRepository(t, false);
  const before = template.status();
  const to = output(t);
  const result = copy(template, to);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /packages\/template-ts has no build: packages\/template-ts\/dist\.inputs\.json is missing; build it in the template repository with `make build-ts`/);
  assert.equal(template.status(), before);
  assert.equal(existsSync(to), false);
});

test('the copy takes the head commit while the checkout of the template repository is at a later commit', (t) => {
  const template = templateRepository(t, true);
  writeFileSync(join(template.directory, 'contracts/functions.json'), '{"next": true}\n');
  template.git('commit', '-q', '-am', 'next');
  const to = output(t);
  const result = copy(template, to);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(to, 'contracts/functions.json'), 'utf8'), '{}\n');
});

test('the copy fails for a branch that the template repository does not have and names it', (t) => {
  const template = templateRepository(t, true);
  writeFileSync(template.config, `${JSON.stringify({ branch: 'missing' })}\n`);
  const to = output(t);
  const result = copy(template, to);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`has no branch missing, which ${template.config} names`), result.stderr);
  assert.equal(existsSync(to), false);
});

test('the copy fails for a build of other inputs than the head commit and names the expected and the actual inputs', (t) => {
  const template = templateRepository(t, true);
  const first = template.git('rev-parse', 'HEAD').trim();
  // A source change committed without a build: the record names the inputs of the earlier commit.
  const recorded = inputsHash(template.directory);
  writeFileSync(join(template.directory, 'packages/template-ts/src/index.ts'), 'export const built = 2;\n');
  template.git('commit', '-q', '-am', 'source');
  template.declareCommit(template.git('rev-parse', 'HEAD').trim());
  const to = output(t);
  const stale = copy(template, to);
  assert.notEqual(stale.status, 0);
  assert.ok(stale.stderr.includes(`records a build of the inputs ${recorded}, expected the inputs ${inputsHash(template.directory)} of the head commit`), stale.stderr);
  // A build of the later commit while the branch is at the earlier one.
  build(template.directory);
  template.declareCommit(first);
  const later = copy(template, to);
  assert.notEqual(later.status, 0);
  assert.ok(later.stderr.includes(`records a build of the inputs ${inputsHash(template.directory)}, expected the inputs ${recorded} of the head commit ${first}`), later.stderr);
  // An input that the head commit does not have.
  writeFileSync(join(template.directory, 'scripts/build-package.mjs'), `process.stdout.write(${JSON.stringify([...INPUTS, 'packages/template-ts/src/extra.ts'].join('\n'))} + '\\n');\n`);
  const extra = copy(template, to);
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, /differ from the head commit [0-9a-f]{40}: packages\/template-ts\/src\/extra\.ts is not in the commit/);
  assert.equal(existsSync(to), false);
});

test('make template copies the head commit only when config/template.json or the copy script changed, and builds nothing in the template repository', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-stamp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const templateRun = () => dryRun('template', { variables: [`TEMPLATE_DIR=${directory}`] }).join('\n');
  const first = templateRun();
  assert.match(first, new RegExp(`^node scripts/copy-template\\.mjs --repository \\.\\./template --config config/template\\.json --output ${directory}$`, 'm'));
  assert.doesNotMatch(first, /npm run build|cd \.\.\/template/);
  writeFileSync(join(directory, 'installed.stamp'), '');
  assert.doesNotMatch(templateRun(), /copy-template/);
});

test('npm installs the template package as a copy inside this checkout', () => {
  for (const path of ['node_modules/@polyspec/template', 'packages/hyper-js/node_modules/@polyspec/template', 'packages/hyper-node/node_modules/@polyspec/template']) {
    if (!existsSync(join(repository, path))) continue;
    assert.equal(lstatSync(join(repository, path)).isSymbolicLink(), false, path);
    assert.ok(realpathSync(join(repository, path)).startsWith(`${repository}/`), path);
  }
  assert.equal(lstatSync(join(repository, 'node_modules/@polyspec/template')).isDirectory(), true);
});

test('Composer, PHPStan and the native extension build read the declared copy', () => {
  for (const manifest of ['packages/hyper-php/composer.json', 'examples/board/composer.json']) {
    const repositories = JSON.parse(readFileSync(manifest, 'utf8')).repositories.filter((item) => item.url.endsWith('/template-php'));
    assert.equal(repositories.length, 1, manifest);
    assert.equal(resolve(dirname(manifest), repositories[0].url), join(COPY, 'packages/template-php'), manifest);
    assert.equal(repositories[0].options.symlink, false, manifest);
  }
  const scanned = /scanFiles:\n\s+- (\S+)/.exec(readFileSync('packages/hyper-php/phpstan.neon', 'utf8'))[1];
  assert.equal(resolve('packages/hyper-php', scanned), join(COPY, 'packages/template-php-ext/stubs/polyspec_template.stub.php'));
  assert.match(dryRun('ext').join('\n'), /^cd var\/products\/template\/packages\/template-php-ext && cargo build --locked --release --target-dir \S+\/build\/ext$/m);
});
