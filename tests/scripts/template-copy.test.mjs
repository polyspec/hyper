// Tests that this repository reads the template repository only through its declared copy (HY-78): the copy script
// writes the copy without writing into the template repository, npm installs the TypeScript package as a copy inside
// this checkout, and Composer, PHPStan and the native extension build read the copy.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const COPY = join(repository, 'var', 'products', 'template');

// A template repository with one tracked file in every copied path and an untracked build of the TypeScript package.
function templateRepository(t, withBuild) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    '.gitignore': 'dist/\n',
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1', type: 'module', files: ['dist'], exports: { '.': { import: './dist/index.mjs' } } }),
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    'packages/template-php/bin/template.php': '<?php\n',
    'packages/template-php-ext/Cargo.toml': '[package]\n',
    'packages/template-rust/Cargo.toml': '[package]\n',
    'tools/compiler/compiler.mjs': 'export {};\n',
    'contracts/functions.json': '{}\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text, { mode: path.endsWith('template.php') ? 0o755 : 0o644 });
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (withBuild) {
    mkdirSync(join(directory, 'packages/template-ts/dist'));
    writeFileSync(join(directory, 'packages/template-ts/dist/index.mjs'), 'export const built = true;\n');
  }
  return { directory, status: () => git('status', '--porcelain', '--ignored') };
}

const copy = (from, to) => spawnSync(process.execPath, [join(repository, 'scripts', 'copy-template.mjs'), '--repository', from, '--output', to], { encoding: 'utf8' });

test('the copy holds the packed TypeScript package and the tracked paths and writes nothing into the template repository', (t) => {
  const template = templateRepository(t, true);
  const before = template.status();
  const output = join(mkdtempSync(join(tmpdir(), 'hyper-template-copy-')), 'template');
  t.after(() => rmSync(dirname(output), { recursive: true, force: true }));
  const result = copy(template.directory, output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(template.status(), before);
  assert.equal(readFileSync(join(output, 'packages/template-ts/dist/index.mjs'), 'utf8'), 'export const built = true;\n');
  for (const path of ['packages/template-php/composer.json', 'packages/template-php-ext/Cargo.toml', 'packages/template-rust/Cargo.toml', 'tools/compiler/compiler.mjs', 'contracts/functions.json']) {
    assert.ok(existsSync(join(output, path)), path);
    assert.equal(Math.floor(statSync(join(output, path)).mtimeMs), Math.floor(statSync(join(template.directory, path)).mtimeMs), path);
  }
  assert.equal(statSync(join(output, 'packages/template-php/bin/template.php')).mode & 0o111, 0o111);
  assert.equal(existsSync(`${output}.next`), false);
});

test('the copy fails without a build of the TypeScript package and names the build command', (t) => {
  const template = templateRepository(t, false);
  const before = template.status();
  const output = join(mkdtempSync(join(tmpdir(), 'hyper-template-copy-')), 'template');
  t.after(() => rmSync(dirname(output), { recursive: true, force: true }));
  const result = copy(template.directory, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /packages\/template-ts has no build: .*dist\/index\.mjs missing; build it in the template repository with `make build-ts`/);
  assert.equal(template.status(), before);
  assert.equal(existsSync(output), false);
});

test('make template copies the template repository and builds nothing in it', () => {
  const result = spawnSync('make', ['-n', 'template'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^node scripts\/copy-template\.mjs --repository \.\.\/template --output var\/products\/template$/m);
  assert.doesNotMatch(result.stdout, /npm run build|cd \.\.\/template/);
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
  const ext = spawnSync('make', ['-n', 'ext'], { encoding: 'utf8' });
  assert.match(ext.stdout, /cargo build --locked --release --manifest-path var\/products\/template\/packages\/template-php-ext\/Cargo\.toml/);
});
