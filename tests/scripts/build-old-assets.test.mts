// Tests the removal of the files of the build before (HR-34, HYC-16.15): after `hyper build` published its outputs, it
// removes below public/assets exactly the files that client/assets.json of the build before it names and its own list
// does not, and prints each. Each test builds a copy of the fixture `chunks`; a changed source changes the name of a
// hashed file. No test waits for a time: a build is one process that the test runs to its end.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { listFiles } from '../../packages/cli/lib/output-files.mjs';
import { jsonArray, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { fixture, runBuild } from './build-fixture.mts';

/** Every file below public/assets of the application, by its path from the application directory, in byte order. */
function assetsOf(app: string): string[] {
  return listFiles(join(app, 'public', 'assets')).map((file) => relative(app, file).split('\\').join('/')).sort();
}

/** The paths that client/assets.json of the last build lists. */
function listed(app: string): string[] {
  const file = join(app, 'out', 'client', 'assets.json');
  return jsonArray(parseJsonObject(readFileSync(file, 'utf8'), file).files, 'files').map((path) => jsonString(path, 'path'));
}

/** The lines `removed <path>` that a build printed, as their paths. */
function removedOf(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.startsWith('removed ')).map((line) => line.slice('removed '.length));
}

/** The application file that the build does not write, placed below public/assets by the test. */
function ownFile(app: string): string {
  mkdirSync(join(app, 'public', 'assets'), { recursive: true });
  writeFileSync(join(app, 'public', 'assets', 'hyper-own.js'), '// placed by the application\n');
  return 'public/assets/hyper-own.js';
}

test('a first build, without a list of a build before it, removes nothing', (t) => {
  const app = fixture('chunks', t);
  // The name has the form of an entry of the build: no file is removed for the form of its name.
  const own = ownFile(app);
  assert.equal(existsSync(join(app, 'out', 'client', 'assets.json')), false);
  const result = runBuild(app, '--api', '/api');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(removedOf(result.stdout), []);
  assert.ok(assetsOf(app).includes(own));
  assert.ok(!listed(app).includes(own));
  assert.deepEqual(assetsOf(app), [...listed(app), own].sort());
});

test('a second build removes the files of the first that it no longer writes, prints each and keeps the file of the application', (t) => {
  const app = fixture('chunks', t);
  const own = ownFile(app);
  const first = runBuild(app, '--api', '/api');
  assert.equal(first.status, 0, first.stderr);
  const before = listed(app);
  writeFileSync(join(app, 'client', 'forms.ts'), "export function bindForms(): void {\n  console.log('chunk: bind the forms again');\n}\n");
  writeFileSync(join(app, 'templates', 'home.tpl'), '<p>home again</p>\n');
  const second = runBuild(app, '--api', '/api');
  assert.equal(second.status, 0, second.stderr);
  const after = listed(app);
  const gone = before.filter((path) => !after.includes(path));
  // The changed sources changed the names of the chunk, of the entry that imports it and of the template file.
  assert.ok(gone.some((path) => /^public\/assets\/hyper-chunk-/u.test(path)), gone.join(' '));
  assert.ok(gone.some((path) => /^public\/assets\/templates\/home\./u.test(path)), gone.join(' '));
  for (const path of gone) assert.equal(existsSync(join(app, path)), false, path);
  assert.deepEqual(removedOf(second.stdout).sort(), [...gone].sort());
  // What stays: every file of the second list, and the file that the application placed itself.
  assert.deepEqual(assetsOf(app), [...after, own].sort());
  assert.equal(readFileSync(join(app, own), 'utf8'), '// placed by the application\n');
});

test('a build with the sources of the build before it removes nothing', (t) => {
  const app = fixture('chunks', t);
  const first = runBuild(app, '--api', '/api');
  assert.equal(first.status, 0, first.stderr);
  const before = assetsOf(app);
  const second = runBuild(app, '--api', '/api');
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(removedOf(second.stdout), []);
  assert.deepEqual(assetsOf(app), before);
});

test('a list of the build before that names a path outside public/assets fails the build before it writes', (t) => {
  const app = fixture('chunks', t);
  const outside = join(app, 'app', 'app.json');
  assert.ok(existsSync(outside));
  mkdirSync(join(app, 'out', 'client'), { recursive: true });
  writeFileSync(join(app, 'out', 'client', 'assets.json'), JSON.stringify({ files: ['public/assets/../../app/app.json'] }));
  const result = runBuild(app, '--api', '/api');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assets\.json of the build before this one is not a list of the files below public\/assets/u);
  assert.ok(existsSync(outside));
  // The build wrote no file: public/assets does not exist and client/ holds only the list that the test wrote.
  assert.equal(existsSync(join(app, 'public', 'assets')), false);
  assert.deepEqual(readdirSync(join(app, 'out', 'client')), ['assets.json']);
});
