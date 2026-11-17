// Tests the removal of the files of earlier builds (HR-34, HYC-16.17 to HYC-16.22): a build whose list of files differs
// from that of the build before it removes below public/assets the files that client/assets.previous.json named and
// that neither the list of the build before nor its own list names, and prints each, so the files of the build before
// stay for its open pages. Each test builds a copy of the fixture `chunks`; a changed source changes the name of a
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

/** The paths that a list of client/ names: `assets.json` of the last build, or `assets.previous.json`. */
function listed(app: string, name = 'assets.json'): string[] {
  const file = join(app, 'out', 'client', name);
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

/** Builds the application with the chunk code and the home template of a version, and returns the output of the build. */
function buildVersion(app: string, version: string): string {
  writeFileSync(join(app, 'client', 'forms.ts'), `export function bindForms(): void {\n  console.log('chunk: bind the forms ${version}');\n}\n`);
  writeFileSync(join(app, 'templates', 'home.tpl'), `<p>home ${version}</p>\n`);
  const result = runBuild(app, '--api', '/api');
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/** The paths of a list that another list does not name. */
const without = (paths: string[], other: string[]): string[] => paths.filter((path) => !other.includes(path));

test('a first build, without a list of a build before it, removes nothing', (t) => {
  const app = fixture('chunks', t);
  // The name has the form of an entry of the build: no file is removed for the form of its name.
  const own = ownFile(app);
  assert.equal(existsSync(join(app, 'out', 'client', 'assets.json')), false);
  assert.deepEqual(removedOf(buildVersion(app, 'a')), []);
  assert.deepEqual(assetsOf(app), [...listed(app), own].sort());
  assert.deepEqual(listed(app, 'assets.previous.json'), []);
});

test('the files of a build stay through the build after it and are removed and printed by the second different build after it', (t) => {
  const app = fixture('chunks', t);
  const own = ownFile(app);
  buildVersion(app, 'a');
  const a = listed(app);
  // B: the files of A stay, for the pages of A that are still open.
  assert.deepEqual(removedOf(buildVersion(app, 'b')), []);
  const b = listed(app);
  assert.ok(without(a, b).some((path) => /^public\/assets\/hyper-chunk-/u.test(path)), without(a, b).join(' '));
  assert.ok(without(a, b).some((path) => /^public\/assets\/templates\/home\./u.test(path)), without(a, b).join(' '));
  assert.deepEqual(assetsOf(app), [...new Set([...a, ...b, own])].sort());
  assert.deepEqual(listed(app, 'assets.previous.json'), a);
  // C: the files of A that neither B nor C writes are gone and printed; the files of B and of the application stay.
  const removed = removedOf(buildVersion(app, 'c'));
  const c = listed(app);
  const gone = without(without(a, b), c);
  assert.ok(gone.length > 0);
  assert.deepEqual([...removed].sort(), [...gone].sort());
  for (const path of gone) assert.equal(existsSync(join(app, path)), false, path);
  assert.deepEqual(assetsOf(app), [...new Set([...b, ...c, own])].sort());
  assert.deepEqual(listed(app, 'assets.previous.json'), b);
  assert.equal(readFileSync(join(app, own), 'utf8'), '// placed by the application\n');
});

test('builds of unchanged sources move no list, so the files of the last different build stay through them', (t) => {
  const app = fixture('chunks', t);
  buildVersion(app, 'a');
  const a = listed(app);
  buildVersion(app, 'b');
  const b = listed(app);
  // Two builds of the sources of B: nothing is removed, and assets.previous.json still names the files of A.
  for (let run = 0; run < 2; run += 1) {
    assert.deepEqual(removedOf(buildVersion(app, 'b')), []);
    assert.deepEqual(listed(app), b);
    assert.deepEqual(listed(app, 'assets.previous.json'), a);
    assert.deepEqual(assetsOf(app), [...new Set([...a, ...b])].sort());
  }
  // The next different build removes the files of A, as it would have without the two builds between, and keeps B.
  const removed = removedOf(buildVersion(app, 'c'));
  const c = listed(app);
  assert.deepEqual([...removed].sort(), without(without(a, b), c).sort());
  assert.deepEqual(assetsOf(app), [...new Set([...b, ...c])].sort());
});

test('a build that returns to the sources of two builds before removes none of the files that it writes again', (t) => {
  const app = fixture('chunks', t);
  buildVersion(app, 'a');
  const a = listed(app);
  buildVersion(app, 'b');
  const b = listed(app);
  assert.deepEqual(removedOf(buildVersion(app, 'a')), []);
  assert.deepEqual(listed(app), a);
  assert.deepEqual(assetsOf(app), [...new Set([...a, ...b])].sort());
});

test('a list of an earlier build that names a path outside public/assets fails the build before it writes, with the file, the path and the repair', (t) => {
  const app = fixture('chunks', t);
  const outside = join(app, 'app', 'app.json');
  assert.ok(existsSync(outside));
  mkdirSync(join(app, 'out', 'client'), { recursive: true });
  const list = join(app, 'out', 'client', 'assets.previous.json');
  writeFileSync(list, JSON.stringify({ files: ['public/assets/../../app/app.json'] }));
  const result = runBuild(app, '--api', '/api');
  assert.notEqual(result.status, 0);
  // The error names the file of the list, the path that it refuses and the repair (HYC-16.22). The file is compared by
  // its path below the output directory, because the bin may name the directory of the test by another path.
  const named = join('out', 'client', 'assets.previous.json');
  assert.match(
    result.stderr,
    new RegExp(
      `${RegExp.escape(named)} of an earlier build names "public/assets/\\.\\./\\.\\./app/app\\.json", which is no path of a file below public/assets; the build removes files that this list names, so remove or correct \\S*${RegExp.escape(named)} and build again`,
      'u',
    ),
  );
  assert.ok(existsSync(outside));
  // The build wrote no file: public/assets does not exist and client/ holds only the list that the test wrote.
  assert.equal(existsSync(join(app, 'public', 'assets')), false);
  assert.deepEqual(readdirSync(join(app, 'out', 'client')), ['assets.previous.json']);
});
