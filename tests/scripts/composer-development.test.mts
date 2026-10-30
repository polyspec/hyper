// HR-70, HR-79: Composer owns selected development constraints, locks, source links and installed records.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { jsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { mainTools } from './main-tools.mts';

const root = resolve('.');
const composer = join(mainTools(), 'mise/shims/composer');
const object = (file: string) => parseJsonObject(readFileSync(file, 'utf8'), file);

test('make preserves the native COMPOSER manifest selector', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-composer-selector-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const extra = join(directory, 'manifest.mk');
  writeFileSync(extra, 'show-native-manifest:\n\t@printf \'%s\\n\' "$$COMPOSER"\n');
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const result = spawnSync('make', ['--no-print-directory', '-s', '-f', 'Makefile', '-f', extra, 'show-native-manifest'], { encoding: 'utf8', env: { ...env, COMPOSER: 'composer.local.json' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'composer.local.json');
});

test('native Composer accepts the supported provider versions and refuses an unverified one', (t) => {
  // The template version that the PHP library requires; its neighbours are refused.
  const supported = jsonString(jsonObject(object('packages/server/php/composer.json').require, 'server require')['polyspec/template'], 'server require polyspec/template');
  const [major, minor, patch] = supported.split('.').map(Number);
  assert.ok(major !== undefined && minor !== undefined && patch !== undefined && patch > 0, supported);
  for (const version of [`${major}.${minor}.${patch - 1}`, supported, `${major}.${minor}.${patch + 1}`]) {
    const directory = mkdtempSync(join(tmpdir(), 'hyper-composer-constraint-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, 'server'));
    mkdirSync(join(directory, 'template'));
    cpSync('packages/server/php/composer.json', join(directory, 'server/composer.json'));
    writeFileSync(join(directory, 'template/composer.json'), JSON.stringify({ name: 'polyspec/template', version, require: { php: '>=8.4' } }));
    writeFileSync(join(directory, 'composer.json'), JSON.stringify({
      name: 'polyspec/hyper-constraint-test', version: '0.0.1',
      repositories: [{ type: 'path', url: 'server', options: { reference: 'config' } }, { type: 'path', url: 'template', options: { reference: 'config' } }, { 'packagist.org': false }],
      require: { 'polyspec/hyper-server': jsonString(object('packages/server/php/composer.json').version, 'server version'), 'polyspec/template': version },
      config: { platform: { php: '8.4.1' } },
    }));
    const result = spawnSync(composer, ['update', '--no-install', '--no-scripts', '--no-plugins', '--no-interaction', '--no-audit'], { cwd: directory, encoding: 'utf8', env: { ...process.env, COMPOSER: 'composer.json', COMPOSER_DISABLE_NETWORK: '1' } });
    if (version !== supported) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /polyspec\/template/);
      assert.ok(result.stderr.includes(version), result.stderr);
      assert.ok(result.stderr.includes(supported), result.stderr);
    } else {
      assert.equal(result.status, 0, `${version}: ${result.stdout}${result.stderr}`);
      const packages = jsonObjects(object(join(directory, 'composer.lock')).packages, 'resolved packages');
      assert.equal(packages.find((entry) => entry.name === 'polyspec/template')?.version, version);
    }
  }
});

test('native development records are checked in an isolated fixture, including stale version and archive records', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-composer-records-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'provider'));
  writeFileSync(join(directory, 'provider/composer.json'), JSON.stringify({ name: 'polyspec/template', version: '0.0.13', require: { php: '>=8.4' } }));
  for (const [project, source] of [[directory, 'provider'], [join(directory, 'examples/board'), '../../provider']]) {
    assert.ok(project && source);
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'composer.local.json'), JSON.stringify({
      name: 'polyspec/hyper-records-test', version: '0.0.1',
      repositories: [{ type: 'path', url: source, options: { symlink: true, reference: 'config' } }, { 'packagist.org': false }],
      require: { 'polyspec/template': '0.0.13' },
    }));
    const result = spawnSync(composer, ['update', '--no-scripts', '--no-plugins', '--no-interaction', '--no-audit'], { cwd: project, encoding: 'utf8', env: { ...process.env, COMPOSER: 'composer.local.json', COMPOSER_DISABLE_NETWORK: '1' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const check = () => spawnSync(process.execPath, ['scripts/check-composer-development.mts', '--root', directory], { cwd: root, encoding: 'utf8' });
  const valid = check();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /2 declared source packages/);
  const file = join(directory, 'vendor/composer/installed.json');
  const original = readFileSync(file, 'utf8');
  const stale = object(file);
  const packages = jsonObjects(stale.packages, 'installed fixture packages');
  const installed = packages.find((entry) => entry.name === 'polyspec/template');
  assert.ok(installed);
  installed.version = '0.0.11';
  stale.packages = packages;
  writeFileSync(file, JSON.stringify(stale));
  const wrongVersion = check();
  assert.notEqual(wrongVersion.status, 0);
  assert.match(wrongVersion.stderr, /source version differs from installed version/);
  writeFileSync(file, original);
  const archive = object(file);
  const archivePackages = jsonObjects(archive.packages, 'archive fixture packages');
  const entry = archivePackages.find((item) => item.name === 'polyspec/template');
  assert.ok(entry);
  entry.dist = { type: 'zip', url: 'https://example.invalid/archive.zip' };
  archive.packages = archivePackages;
  writeFileSync(file, JSON.stringify(archive));
  const wrongSource = check();
  assert.notEqual(wrongSource.status, 0);
  assert.match(wrongSource.stderr, /installed source is not a native path repository/);
});
