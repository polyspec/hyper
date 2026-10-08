// Tests that this repository reads the template repository only through its declared copy (HY-78) of the commit of its
// tag TEMPLATE_TAG (HY-80), and only for the native extension: the copy script copies the C sources and the stub of the
// extension and its build script of that commit whatever commit the branch main or the working tree of the template
// checkout is at, fails with the expected and the actual value for a missing tag, `make template-tag` fails for a
// template checkout without the tag, the copy writes nothing into the template repository and nothing into a current
// copy, and `make template` runs the copy every time and installs nothing; PHPStan and the native extension build read
// the copy, and npm and Composer install the template packages from the assets of the template release (HY-70).
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
// The tag TEMPLATE_TAG of the Makefile, the one declaration of the template release (HY-80).
const TAG = /^TEMPLATE_TAG := (\S+)$/m.exec(readFileSync(join(repository, 'Makefile'), 'utf8'))[1];
const CONFIG = 'packages/template-php-ext/src/config.m4';

// A template repository with one tracked file in every copied path and in paths that are not copied, and the tag TAG at
// its commit unless `tagged` is false.
function templateRepository(t, tagged = true) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1' }),
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    [CONFIG]: 'PHP_NEW_EXTENSION(polyspec_template, polyspec_template.c, $ext_shared)\n',
    'packages/template-php-ext/src/polyspec_template.stub.php': '<?php\n',
    'packages/template-php-ext/tests/EngineTest.php': '<?php\n',
    'packages/template-compiler/compiler.mjs': 'export {};\n',
    'package-lock.json': '{}\n',
    'scripts/build-php-extension.mjs': 'export {};\n',
    'scripts/publish-build.mjs': 'export {};\n',
    'scripts/temporary-workspace.mjs': 'export {};\n',
    'scripts/test-progress/step.mjs': 'export {};\n',
    'scripts/other.mjs': 'export {};\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (tagged) git('tag', TAG);
  return {
    directory, git,
    main: () => git('rev-parse', 'main').trim(),
    tagged: () => git('rev-parse', `refs/tags/${TAG}^{commit}`).trim(),
    // Points the tag at a commit.
    tag: (commit) => git('tag', '--force', TAG, commit),
    status: () => git('status', '--porcelain', '--ignored'),
  };
}

function output(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-copy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'template');
}

const copy = (template, to, tag = TAG) => spawnSync(process.execPath, [join(repository, 'scripts', 'copy-template.mjs'), '--repository', template.directory, '--tag', tag, '--output', to], { encoding: 'utf8' });
const scriptHash = createHash('sha256').update(readFileSync(join(repository, 'scripts', 'copy-template.mjs'))).digest('hex');

test('the copy holds the extension sources and their build script of the commit of the tag and writes nothing into the template repository', (t) => {
  const template = templateRepository(t);
  // A change of the working tree that is not committed is not part of the copy.
  writeFileSync(join(template.directory, CONFIG), 'changed\n');
  const before = template.status();
  const to = output(t);
  const result = copy(template, to);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(template.status(), before);
  assert.equal(readFileSync(join(to, CONFIG), 'utf8'), 'PHP_NEW_EXTENSION(polyspec_template, polyspec_template.c, $ext_shared)\n');
  const committed = Number(template.git('log', '-1', '--format=%ct').trim());
  // `make ext` runs the build script of the template repository with the scripts that it imports, and PHPStan reads the stub.
  const copied = [CONFIG, 'packages/template-php-ext/src/polyspec_template.stub.php',
    'scripts/build-php-extension.mjs', 'scripts/publish-build.mjs', 'scripts/temporary-workspace.mjs', 'scripts/test-progress/step.mjs'];
  for (const path of copied) {
    assert.ok(existsSync(join(to, path)), path);
    // The modification time is the commit time, the same on every machine.
    assert.equal(Math.floor(statSync(join(to, path)).mtimeMs / 1000), committed, path);
  }
  // npm and Composer install the template packages from the release, so the copy holds no package and no other file.
  for (const path of ['packages/template-ts', 'packages/template-php', 'packages/template-compiler', 'package-lock.json', 'packages/template-php-ext/tests/EngineTest.php', 'scripts/other.mjs']) {
    assert.equal(existsSync(join(to, path)), false, path);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(to, 'copy.json'), 'utf8')), { tag: TAG, commit: template.tagged(), script: scriptHash });
  assert.equal(existsSync(`${to}.next`), false);
});

test('the copy takes the commit of the tag while the branch main has moved on and the working tree is at another branch', (t) => {
  const template = templateRepository(t);
  writeFileSync(join(template.directory, CONFIG), '{"main": true}\n');
  template.git('commit', '-q', '-am', 'main');
  template.git('checkout', '-q', '-b', 'side');
  writeFileSync(join(template.directory, CONFIG), '{"side": true}\n');
  template.git('commit', '-q', '-am', 'side');
  assert.notEqual(template.main(), template.tagged());
  const to = output(t);
  const result = copy(template, to);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`the tag ${TAG.replaceAll('.', '\\.')} of \\S+ at ${template.tagged()} `));
  assert.equal(readFileSync(join(to, CONFIG), 'utf8'), 'PHP_NEW_EXTENSION(polyspec_template, polyspec_template.c, $ext_shared)\n');
  assert.equal(JSON.parse(readFileSync(join(to, 'copy.json'), 'utf8')).commit, template.tagged());
});

test('the copy fails for a tag that the template repository does not have and names the expected tag and the tags it has', (t) => {
  const template = templateRepository(t);
  const to = output(t);
  const result = copy(template, to, 'v9.9.9');
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`${template.directory} has no tag v9.9.9: expected the tag v9.9.9, actual tags ${TAG}`), result.stderr);
  assert.equal(existsSync(to), false);
  // A template checkout without any tag, such as a clone of the branch main alone.
  const untagged = templateRepository(t, false);
  const none = copy(untagged, to);
  assert.notEqual(none.status, 0);
  assert.ok(none.stderr.includes(`${untagged.directory} has no tag ${TAG}: expected the tag ${TAG}, actual tags none`), none.stderr);
  assert.equal(existsSync(to), false);
});

test('make template-tag fails for a template checkout without the tag TEMPLATE_TAG and passes with it', (t) => {
  const make = (template) => spawnSync('make', ['--no-print-directory', 'template-tag', `TEMPLATE_REPOSITORY=${template.directory}`], {
    cwd: repository, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))),
  });
  const untagged = templateRepository(t, false);
  const missing = make(untagged);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, new RegExp(`template-tag: \\S+ has no tag ${TAG.replaceAll('.', '\\.')}: expected the tag ${TAG.replaceAll('.', '\\.')}, actual tags: \\n`));
  const tagged = templateRepository(t);
  const found = make(tagged);
  assert.equal(found.status, 0, found.stderr);
});

test('the copy writes nothing while the copy holds the commit of the tag, and copies again when the tag names another commit', (t) => {
  const template = templateRepository(t);
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
  writeFileSync(join(template.directory, CONFIG), '{"next": true}\n');
  template.git('commit', '-q', '-am', 'next');
  const branchMoved = copy(template, to);
  assert.equal(branchMoved.status, 0, branchMoved.stderr);
  assert.match(branchMoved.stdout, /nothing to copy/);
  assert.equal(statSync(record).mtimeMs, written);
  template.tag(template.main());
  const moved = copy(template, to);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(readFileSync(join(to, CONFIG), 'utf8'), '{"next": true}\n');
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).commit, template.tagged());
});

test('make template checks the tag and runs the copy of the tag every time, installs nothing and builds nothing in the template repository', () => {
  const directory = join(tmpdir(), 'hyper-template-copy-run');
  const run = dryRun('template', { variables: [`TEMPLATE_DIR=${directory}`] }).join('\n');
  // make template-tag checks the tag of the template checkout before the copy.
  assert.match(run, new RegExp(`^git -C \\.\\./template rev-parse --verify --quiet 'refs/tags/${TAG.replaceAll('.', '\\.')}\\^\\{commit\\}'`, 'm'));
  assert.match(run, new RegExp(`^node scripts/copy-template\\.mjs --repository \\.\\./template --tag ${TAG.replaceAll('.', '\\.')} --output ${directory}$`, 'm'));
  assert.doesNotMatch(run, /publish\.mjs|npm|composer|cd \.\.\/template/);
});

test('npm installs the template package as one copy inside this checkout', () => {
  requireBuilt('install', 'node_modules/@polyspec/template/package.json');
  const path = 'node_modules/@polyspec/template';
  assert.equal(lstatSync(join(repository, path)).isSymbolicLink(), false, path);
  assert.equal(lstatSync(join(repository, path)).isDirectory(), true, path);
  assert.ok(realpathSync(join(repository, path)).startsWith(`${repository}/`), path);
  // The packages of the workspace resolve the root package through the overrides, so they hold no copy of their own.
  for (const nested of ['packages/hyper-js/node_modules/@polyspec/template', 'packages/hyper-node/node_modules/@polyspec/template']) {
    assert.equal(existsSync(join(repository, nested)), false, nested);
  }
});

test('Composer installs the template PHP package from the zip of the template release, and PHPStan and the native extension build read the declared copy', () => {
  const version = JSON.parse(readFileSync('packages/hyper-php/composer.json', 'utf8')).require['polyspec/template'];
  assert.match(version, /^\d+\.\d+\.\d+$/, 'packages/hyper-php requires an exact template version');
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const { repositories, require } = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.equal(require['polyspec/template'], version, manifest);
    assert.deepEqual(repositories.filter((item) => String(item.url).includes('var/products/template')), [], manifest);
    const packages = repositories.filter((item) => item.type === 'package' && item.package.name === 'polyspec/template');
    assert.equal(packages.length, 1, manifest);
    assert.equal(packages[0].package.version, version, manifest);
    assert.deepEqual({ ...packages[0].package.dist, shasum: undefined }, { type: 'zip', url: `https://github.com/polyspec/template/releases/download/v${version}/polyspec-template-php-${version}.zip`, shasum: undefined }, manifest);
    assert.match(packages[0].package.dist.shasum, /^[0-9a-f]{40}$/, `${manifest}: the zip is pinned by its shasum`);
    const lock = JSON.parse(readFileSync(manifest.replace(/\.json$/, '.lock'), 'utf8'));
    assert.deepEqual(lock.packages.find(({ name }) => name === 'polyspec/template').dist, packages[0].package.dist, manifest);
  }
  const scanned = /scanFiles:\n\s+- (\S+)/.exec(readFileSync('packages/hyper-php/phpstan.neon', 'utf8'))[1];
  assert.equal(resolve('packages/hyper-php', scanned), join(COPY, 'packages/template-php-ext/src/polyspec_template.stub.php'));
  assert.match(dryRun('ext').join('\n'), /^node var\/products\/template\/scripts\/build-php-extension\.mjs var\/products\/template\/packages\/template-php-ext\/src \S+\/build\/ext\/polyspec_template\.so$/m);
});
