// Tests that this repository reads the template repository only through its declared copy (HY-78) of the commit of its
// tag TEMPLATE_TAG (HY-80): the copy script copies that commit whatever commit the branch main or the working tree of
// the template checkout is at, fails with the expected and the actual value for a missing tag and a build of other
// inputs, `make template-tag` fails for a template checkout without the tag, writes nothing into the template repository and writes nothing into a current copy, and the Makefile runs
// the copy on every make template and installs the packages again only when the copy changed; npm installs the
// TypeScript package as a copy inside this checkout, and Composer, PHPStan and the native extension build read the
// copy, which holds what the compiler of the template repository reads.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mjs';
import { requireBuilt } from './requires.mjs';

const repository = resolve('.');
const COPY = join(repository, 'var', 'products', 'template');
const INPUTS = ['packages/template-ts/package.json', 'packages/template-ts/src/index.ts'];
// The tag TEMPLATE_TAG of the Makefile, the one declaration of the template release (HY-80).
const TAG = /^TEMPLATE_TAG := (\S+)$/m.exec(readFileSync(join(repository, 'Makefile'), 'utf8'))[1];

// The hash of the inputs of a TypeScript build, as scripts/build-package.mjs of the template repository records it.
function inputsHash(directory) {
  const hash = createHash('sha256');
  for (const file of INPUTS) hash.update(`${file}\0`).update(readFileSync(join(directory, file))).update('\0');
  hash.update(process.version);
  return hash.digest('hex');
}

// A template repository with one tracked file in every copied path, a build script that prints the inputs of the
// TypeScript build, the tag TAG at its commit unless `tagged` is false, and an untracked build of the TypeScript package
// with its inputs record.
function templateRepository(t, withBuild, tagged = true) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    '.gitignore': 'dist/\ndist.inputs.json\n',
    'scripts/build-package.mjs': `process.stdout.write(${JSON.stringify(INPUTS.join('\n'))} + '\\n');\n`,
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1', type: 'module', files: ['dist'], exports: { '.': { import: './dist/index.mjs' } } }),
    'packages/template-ts/src/index.ts': 'export const built = true;\n',
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    'packages/template-php/bin/template.php': '<?php\n',
    'packages/template-ts/tsconfig.json': '{}\n',
    'packages/template-ts/tsup.config.ts': 'export default {};\n',
    'packages/template-php-ext/src/config.m4': 'PHP_NEW_EXTENSION(polyspec_template, polyspec_template.c, $ext_shared)\n',
    'packages/template-php-ext/src/polyspec_template.stub.php': '<?php\n',
    'packages/template-php-ext/tests/EngineTest.php': '<?php\n',
    'tools/compiler/compiler.mjs': 'export {};\n',
    'contracts/functions.json': '{}\n',
    'package-lock.json': '{}\n',
    'scripts/build-php-extension.mjs': 'export {};\n',
    'scripts/publish-build.mjs': 'export {};\n',
    'scripts/temporary-workspace.mjs': 'export {};\n',
    'scripts/test-progress/step.mjs': 'export {};\n',
    'scripts/other.mjs': 'export {};\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text, { mode: path.endsWith('template.php') ? 0o755 : 0o644 });
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (tagged) git('tag', TAG);
  if (withBuild) build(directory);
  return {
    directory, git,
    main: () => git('rev-parse', 'main').trim(),
    tagged: () => git('rev-parse', `refs/tags/${TAG}^{commit}`).trim(),
    // Points the tag at a commit.
    tag: (commit) => git('tag', '--force', TAG, commit),
    status: () => git('status', '--porcelain', '--ignored'),
  };
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

const copy = (template, to, tag = TAG) => spawnSync(process.execPath, [join(repository, 'scripts', 'copy-template.mjs'), '--repository', template.directory, '--tag', tag, '--output', to], { encoding: 'utf8' });
const scriptHash = createHash('sha256').update(readFileSync(join(repository, 'scripts', 'copy-template.mjs'))).digest('hex');

test('the copy holds the packed TypeScript package and the tracked paths of the commit of the tag and writes nothing into the template repository', (t) => {
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
  // The compiler records the digest of the sources of the TypeScript package, of its build configuration and of the lock,
  // and `make ext` runs the build script of the template repository with the scripts that it imports.
  const copied = ['packages/template-php/composer.json', 'packages/template-php-ext/src/config.m4', 'packages/template-php-ext/src/polyspec_template.stub.php', 'tools/compiler/compiler.mjs', 'contracts/functions.json', 'package-lock.json',
    'packages/template-ts/src/index.ts', 'packages/template-ts/tsconfig.json', 'packages/template-ts/tsup.config.ts',
    'scripts/build-php-extension.mjs', 'scripts/publish-build.mjs', 'scripts/temporary-workspace.mjs', 'scripts/test-progress/step.mjs'];
  for (const path of copied) {
    assert.ok(existsSync(join(to, path)), path);
    // The modification time is the commit time, the same on every machine.
    assert.equal(Math.floor(statSync(join(to, path)).mtimeMs / 1000), committed, path);
  }
  assert.equal(statSync(join(to, 'packages/template-php/bin/template.php')).mode & 0o111, 0o111);
  // The packed package.json stays, and no other file of the template repository is copied.
  assert.equal(JSON.parse(readFileSync(join(to, 'packages/template-ts/package.json'), 'utf8')).name, '@polyspec/template');
  for (const path of ['packages/template-php-ext/tests/EngineTest.php', 'scripts/other.mjs']) assert.equal(existsSync(join(to, path)), false, path);
  assert.deepEqual(JSON.parse(readFileSync(join(to, 'copy.json'), 'utf8')), { tag: TAG, commit: template.tagged(), inputs: inputsHash(template.directory), script: scriptHash });
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

test('the copy takes the commit of the tag while the branch main has moved on and the working tree is at another branch', (t) => {
  const template = templateRepository(t, true);
  writeFileSync(join(template.directory, 'contracts/functions.json'), '{"main": true}\n');
  template.git('commit', '-q', '-am', 'main');
  template.git('checkout', '-q', '-b', 'side');
  writeFileSync(join(template.directory, 'contracts/functions.json'), '{"side": true}\n');
  template.git('commit', '-q', '-am', 'side');
  assert.notEqual(template.main(), template.tagged());
  const to = output(t);
  const result = copy(template, to);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`the tag ${TAG.replaceAll('.', '\\.')} of \\S+ at ${template.tagged()} `));
  assert.equal(readFileSync(join(to, 'contracts/functions.json'), 'utf8'), '{}\n');
  assert.equal(JSON.parse(readFileSync(join(to, 'copy.json'), 'utf8')).commit, template.tagged());
});

test('the copy fails for a tag that the template repository does not have and names the expected tag and the tags it has', (t) => {
  const template = templateRepository(t, true);
  const to = output(t);
  const result = copy(template, to, 'v9.9.9');
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`${template.directory} has no tag v9.9.9: expected the tag v9.9.9, actual tags ${TAG}`), result.stderr);
  assert.equal(existsSync(to), false);
  // A template checkout without any tag, such as a clone of the branch main alone.
  const untagged = templateRepository(t, true, false);
  const none = copy(untagged, to);
  assert.notEqual(none.status, 0);
  assert.ok(none.stderr.includes(`${untagged.directory} has no tag ${TAG}: expected the tag ${TAG}, actual tags none`), none.stderr);
  assert.equal(existsSync(to), false);
});

test('make template-tag fails for a template checkout without the tag TEMPLATE_TAG and passes with it', (t) => {
  const make = (template) => spawnSync('make', ['--no-print-directory', 'template-tag', `TEMPLATE_REPOSITORY=${template.directory}`], {
    cwd: repository, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))),
  });
  const untagged = templateRepository(t, false, false);
  const missing = make(untagged);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, new RegExp(`template-tag: \\S+ has no tag ${TAG.replaceAll('.', '\\.')}: expected the tag ${TAG.replaceAll('.', '\\.')}, actual tags: \\n`));
  const tagged = templateRepository(t, false);
  const found = make(tagged);
  assert.equal(found.status, 0, found.stderr);
});

test('the copy writes nothing while the copy holds the commit of the tag, and copies again when the tag names another commit', (t) => {
  const template = templateRepository(t, true);
  const to = output(t);
  const first = copy(template, to);
  assert.equal(first.status, 0, first.stderr);
  const record = join(to, 'copy.json');
  const written = statSync(record).mtimeMs;
  const again = copy(template, to);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, new RegExp(`holds the commit [0-9a-f]{40} of the tag ${TAG.replaceAll('.', '\\.')}; nothing to copy`));
  assert.equal(statSync(record).mtimeMs, written);
  // A new commit of the branch main does not change the copy.
  writeFileSync(join(template.directory, 'contracts/functions.json'), '{"next": true}\n');
  template.git('commit', '-q', '-am', 'next');
  const branchMoved = copy(template, to);
  assert.equal(branchMoved.status, 0, branchMoved.stderr);
  assert.match(branchMoved.stdout, /nothing to copy/);
  assert.equal(statSync(record).mtimeMs, written);
  template.tag(template.main());
  const moved = copy(template, to);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(readFileSync(join(to, 'contracts/functions.json'), 'utf8'), '{"next": true}\n');
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).commit, template.tagged());
});

test('the copy fails for a build of other inputs than the commit of the tag and names the expected and the actual inputs', (t) => {
  const template = templateRepository(t, true);
  // A source change committed and tagged without a build: the record names the inputs of the earlier commit.
  const first = template.tagged();
  const recorded = inputsHash(template.directory);
  writeFileSync(join(template.directory, 'packages/template-ts/src/index.ts'), 'export const built = 2;\n');
  template.git('commit', '-q', '-am', 'source');
  template.tag(template.main());
  const to = output(t);
  const stale = copy(template, to);
  assert.notEqual(stale.status, 0);
  assert.ok(stale.stderr.includes(`records a build of the inputs ${recorded}, expected the inputs ${inputsHash(template.directory)} of the commit ${template.tagged()} of the tag ${TAG}`), stale.stderr);
  // A build of the later commit of the branch main while the tag names the earlier one.
  build(template.directory);
  template.tag(first);
  const later = copy(template, to);
  assert.notEqual(later.status, 0);
  assert.ok(later.stderr.includes(`records a build of the inputs ${inputsHash(template.directory)}, expected the inputs ${recorded} of the commit ${first} of the tag ${TAG}`), later.stderr);
  assert.notEqual(template.main(), first);
  // An input that the commit of the tag does not have.
  writeFileSync(join(template.directory, 'scripts/build-package.mjs'), `process.stdout.write(${JSON.stringify([...INPUTS, 'packages/template-ts/src/extra.ts'].join('\n'))} + '\\n');\n`);
  const extra = copy(template, to);
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, new RegExp(`differ from the commit [0-9a-f]{40} of the tag ${TAG.replaceAll('.', '\\.')}: packages/template-ts/src/extra\\.ts is not in the commit`));
  assert.equal(existsSync(to), false);
});

test('make template checks the tag and runs the copy of the tag every time, installs the packages only when the copy changed, and builds nothing in the template repository', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-stamp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const templateRun = (...options) => dryRun('template', { variables: [`TEMPLATE_DIR=${directory}`, ...options] }).join('\n');
  const copyLine = new RegExp(`^node scripts/copy-template\\.mjs --repository \\.\\./template --tag ${TAG.replaceAll('.', '\\.')} --output ${directory}$`, 'm');
  const first = templateRun();
  assert.match(first, copyLine);
  // make template-tag checks the tag of the template checkout before the copy.
  assert.match(first, new RegExp(`^git -C \\.\\./template rev-parse --verify --quiet 'refs/tags/${TAG.replaceAll('.', '\\.')}\\^\\{commit\\}'`, 'm'));
  assert.match(first, /publish\.mjs npm-copy/);
  assert.doesNotMatch(first, /npm run build|cd \.\.\/template/);
  writeFileSync(join(directory, 'copy.json'), '{}\n');
  writeFileSync(join(directory, 'installed.stamp'), '');
  // The copy runs while the stamp exists, because the tag may name another commit.
  assert.match(templateRun(), copyLine);
  // A copy that the copy script left unchanged installs nothing.
  const unchanged = templateRun('-o', join(directory, 'copy.json'));
  assert.doesNotMatch(unchanged, /copy-template|publish\.mjs/);
});

test('npm installs the template package as one copy inside this checkout', () => {
  requireBuilt('template', 'node_modules/@polyspec/template/package.json');
  const path = 'node_modules/@polyspec/template';
  assert.equal(lstatSync(join(repository, path)).isSymbolicLink(), false, path);
  assert.equal(lstatSync(join(repository, path)).isDirectory(), true, path);
  assert.ok(realpathSync(join(repository, path)).startsWith(`${repository}/`), path);
  // The packages of the workspace resolve the root copy through the overrides, so they hold no copy of their own.
  for (const nested of ['packages/hyper-js/node_modules/@polyspec/template', 'packages/hyper-node/node_modules/@polyspec/template']) {
    assert.equal(existsSync(join(repository, nested)), false, nested);
  }
});

test('Composer, PHPStan and the native extension build read the declared copy', () => {
  for (const manifest of ['packages/hyper-php/composer.json', 'examples/board/composer.json']) {
    const repositories = JSON.parse(readFileSync(manifest, 'utf8')).repositories.filter((item) => item.url.endsWith('/template-php'));
    assert.equal(repositories.length, 1, manifest);
    assert.equal(resolve(dirname(manifest), repositories[0].url), join(COPY, 'packages/template-php'), manifest);
    assert.equal(repositories[0].options.symlink, false, manifest);
  }
  const scanned = /scanFiles:\n\s+- (\S+)/.exec(readFileSync('packages/hyper-php/phpstan.neon', 'utf8'))[1];
  assert.equal(resolve('packages/hyper-php', scanned), join(COPY, 'packages/template-php-ext/src/polyspec_template.stub.php'));
  assert.match(dryRun('ext').join('\n'), /^node var\/products\/template\/scripts\/build-php-extension\.mjs var\/products\/template\/packages\/template-php-ext\/src \S+\/build\/ext\/polyspec_template\.so$/m);
});
