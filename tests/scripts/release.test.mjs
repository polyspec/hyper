// Tests the release of a tag (scripts/release.mjs, .github/workflows/release.yml). Each case builds a Git repository in
// a temporary directory with the manifests of the release, a changelog, a branch origin/main and the tag, and puts fakes
// of gh and npm first on PATH. The fake gh answers the check runs of the GitHub API from a JSON state file and records
// each call; the fake npm writes the archive that `npm pack` writes. No case reaches GitHub or a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ASSETS, assetName, assetNames, assets, changelogSection, CHECKS, GIT_TAG, GO_MODULES, MANIFESTS, NOT_RELEASED, PACKAGES, parseTag, publish, Stop, verify, versions } from '../../scripts/release.mjs';
import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY = 'polyspec/hyper';

const FAKE_GH = `
import { readFileSync, writeFileSync } from 'node:fs';
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
if (args[0] === 'api' && args[1] === '--paginate') {
  for (const run of state.checkRuns) console.log(JSON.stringify([run.id, run.name, run.status, run.conclusion]));
} else if (args[0] === 'release' && args[1] === 'create') {
  state.notes = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
} else {
  console.error('fake gh: unexpected arguments ' + JSON.stringify(args));
  process.exit(1);
}
writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
`;
const FAKE_NPM = `
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] !== 'pack') process.exit(1);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const name = manifest.name.replace(/^@/, '').replaceAll('/', '-');
writeFileSync(path.join(args[args.indexOf('--pack-destination') + 1], name + '-' + manifest.version + '.tgz'), 'npm');
`;
const CHANGELOG = '# Changelog\n\n## Unreleased\n\n### Added\n\n- A change after the release.\n\n<a id="0-0-1"></a>\n## 0.0.1\n\n### Added\n\n- The first entry of 0.0.1.\n';

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

/** A repository with the manifests of MANIFESTS at one version, a changelog, origin/main and the fakes on PATH. */
function sandbox(t, { version = '0.0.1', changelog = CHANGELOG } = {}) {
  const folder = mkdtempSync(path.join(tmpdir(), 'hyper-release-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'repository');
  const bin = path.join(folder, 'bin');
  const state = path.join(folder, 'state.json');
  mkdirSync(bin);
  for (const [name, source] of [['gh', FAKE_GH], ['npm', FAKE_NPM]]) {
    writeFileSync(path.join(bin, name), `#!${process.execPath}\n${source}`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const names = Object.fromEntries(PACKAGES.map(({ directory, name }) => [directory, name]));
  for (const manifest of MANIFESTS) {
    const file = path.join(root, manifest);
    mkdirSync(path.dirname(file), { recursive: true });
    const name = names[path.dirname(manifest)] ?? '@polyspec/hyper-workspace';
    writeFileSync(file, JSON.stringify(path.basename(manifest) === 'composer.json' ? { name } : { name, version }));
  }
  mkdirSync(path.join(root, 'packages/hyper-php/src'));
  writeFileSync(path.join(root, 'packages/hyper-php/src/App.php'), '<?php\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'release');
  const commit = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
  const checkRuns = (runs) => writeFileSync(state, JSON.stringify({ calls: [], checkRuns: runs.map(([name, conclusion], index) => ({ id: index + 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion })) }));
  checkRuns([['push-gate', 'success'], ['ci-passed', 'success']]);
  const saved = { PATH: process.env.PATH, FAKE_STATE: process.env.FAKE_STATE };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_STATE = state;
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.FAKE_STATE === undefined) delete process.env.FAKE_STATE;
    else process.env.FAKE_STATE = saved.FAKE_STATE;
  });
  return {
    root, commit, checkRuns,
    tag: (tag, at = commit) => { git(root, 'tag', '-a', tag, '-m', tag, at); return tag; },
    recorded: () => JSON.parse(readFileSync(state, 'utf8')),
  };
}

const stops = (action, message) => assert.throws(action, (error) => error instanceof Stop && (message instanceof RegExp ? message.test(error.message) : error.message === message), message.toString());

test('a release tag is a version, or a Go module directory and a version', () => {
  assert.deepEqual(parseTag('v0.0.1'), [null, '0.0.1']);
  assert.deepEqual(parseTag('v10.20.30'), [null, '10.20.30']);
  for (const tag of ['v1.0', '1.0.0', 'v01.0.0', 'v1.0.0-rc.1', 'vX.Y.Z']) stops(() => parseTag(tag), /a release tag is vX\.Y\.Z/);
  stops(() => parseTag('go/v1.0.0'), 'go/v1.0.0: go is not a Go module directory; the Go modules are []');
});

test('every manifest at the version and the changelog section pass the version check', (t) => {
  const box = sandbox(t);
  assert.equal(versions(box.root, 'v0.0.1'), '0.0.1');
});

test('a version mismatch names the file and both values', (t) => {
  const box = sandbox(t);
  writeFileSync(path.join(box.root, 'packages/hyper-node/package.json'), JSON.stringify({ name: '@polyspec/hyper-server', version: '0.0.2' }));
  writeFileSync(path.join(box.root, 'package.json'), JSON.stringify({ name: '@polyspec/hyper-workspace', version: '0.1.0' }));
  stops(() => versions(box.root, 'v0.0.1'), 'package.json: version 0.1.0, the tag v0.0.1 is 0.0.1; packages/hyper-node/package.json: version 0.0.2, the tag v0.0.1 is 0.0.1');
});

test('a composer.json without a version takes the tag, and one with a version is compared', (t) => {
  const box = sandbox(t);
  const composer = path.join(box.root, 'packages/hyper-php/composer.json');
  assert.equal('version' in JSON.parse(readFileSync(composer, 'utf8')), false);
  assert.equal(versions(box.root, 'v0.0.1'), '0.0.1');
  writeFileSync(composer, JSON.stringify({ name: 'polyspec/hyper', version: '0.0.2' }));
  stops(() => versions(box.root, 'v0.0.1'), 'packages/hyper-php/composer.json: version 0.0.2, the tag v0.0.1 is 0.0.1');
});

test('a missing or empty changelog section fails', (t) => {
  stops(() => versions(sandbox(t, { version: '0.0.2' }).root, 'v0.0.2'), 'CHANGELOG.md: no section ## 0.0.2 for the tag v0.0.2');
  const empty = sandbox(t, { changelog: '# Changelog\n\n## Unreleased\n\n## 0.0.1\n\n<a id="x"></a>\n## 0.0.0\n' });
  stops(() => versions(empty.root, 'v0.0.1'), 'CHANGELOG.md: the section ## 0.0.1 has no entry for the tag v0.0.1');
});

test('the section is the release notes without the anchor of the next section', (t) => {
  const box = sandbox(t);
  assert.equal(changelogSection(box.root, '0.0.1'), '### Added\n\n- The first entry of 0.0.1.\n');
  assert.equal(changelogSection(box.root, 'Unreleased'), '### Added\n\n- A change after the release.\n');
});

test('a commit of main with both checks passed is verified', (t) => {
  const box = sandbox(t);
  assert.deepEqual(verify(box.root, box.tag('v0.0.1'), REPOSITORY), { commit: box.commit, checks: ['push-gate', 'ci-passed'] });
  assert.deepEqual(box.recorded().calls, [['api', '--paginate', `repos/${REPOSITORY}/commits/${box.commit}/check-runs?per_page=100`, '--jq', '.check_runs[] | [.id, .name, .status, .conclusion] | @json']]);
});

test('a commit that is not on main fails before any request', (t) => {
  const box = sandbox(t);
  git(box.root, 'commit', '--quiet', '--allow-empty', '-m', 'outside main');
  const outside = git(box.root, 'rev-parse', 'HEAD');
  stops(() => verify(box.root, box.tag('v0.0.1', outside), REPOSITORY), `v0.0.1: the commit ${outside} is not on origin/main; a release tags a commit of main`);
  assert.deepEqual(box.recorded().calls, []);
});

test('a missing, failed or running check is named', (t) => {
  const cases = [
    [[['push-gate', 'success']], 'the check ci-passed is missing'],
    [[['push-gate', 'failure'], ['ci-passed', 'success']], 'the check push-gate is completed with the conclusion failure, not success'],
    [[['push-gate', 'success'], ['ci-passed', null]], 'the check ci-passed is in_progress with the conclusion null, not success'],
    [[], 'the check push-gate is missing; the check ci-passed is missing'],
  ];
  for (const [runs, message] of cases) {
    const box = sandbox(t);
    box.checkRuns(runs);
    stops(() => verify(box.root, box.tag('v0.0.1'), REPOSITORY), `v0.0.1: the commit ${box.commit}: ${message}`);
  }
  assert.deepEqual(CHECKS, ['push-gate', 'ci-passed']);
});

test('the latest run of a check decides', (t) => {
  const box = sandbox(t);
  box.checkRuns([['push-gate', 'success'], ['ci-passed', 'failure'], ['ci-passed', 'success']]);
  assert.equal(verify(box.root, box.tag('v0.0.1'), REPOSITORY).commit, box.commit);
  box.checkRuns([['push-gate', 'success'], ['ci-passed', 'success'], ['ci-passed', 'failure']]);
  stops(() => verify(box.root, 'v0.0.1', REPOSITORY), /the check ci-passed is completed with the conclusion failure/);
});

test('without the repository the verification fails before any request', (t) => {
  const box = sandbox(t);
  stops(() => verify(box.root, box.tag('v0.0.1'), undefined), /GITHUB_REPOSITORY is not set/);
});

test('an archive is named after its package and version', () => {
  assert.equal(assetName('@polyspec/hyper-server', '0.0.1', 'tgz'), 'polyspec-hyper-server-0.0.1.tgz');
  assert.equal(assetName('polyspec/hyper', '1.2.3', 'zip'), 'polyspec-hyper-1.2.3.zip');
  assert.deepEqual(assetNames('v0.0.1'), ['polyspec-hyper-0.0.1.tgz', 'polyspec-hyper-server-0.0.1.tgz', 'polyspec-hyper-0.0.1.zip']);
});

test('assets builds one archive per package', (t) => {
  const box = sandbox(t);
  const names = assets(box.root, box.tag('v0.0.1'));
  assert.deepEqual(readdirSync(path.join(box.root, ASSETS)).sort(), [...names].sort());
  assert.deepEqual(names, assetNames('v0.0.1'));
  const listing = spawnSync('unzip', ['-Z1', path.join(box.root, ASSETS, 'polyspec-hyper-0.0.1.zip')], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(listing.stdout.trim().split('\n').sort(), ['composer.json', 'src/', 'src/App.php']);
});

test('publish creates the release with the notes and the archives', (t) => {
  const box = sandbox(t);
  const tag = box.tag('v0.0.1');
  assets(box.root, tag);
  assert.deepEqual(publish(box.root, tag), assetNames(tag));
  const { calls, notes } = box.recorded();
  const call = calls.at(-1);
  const file = call[call.indexOf('--notes-file') + 1];
  assert.deepEqual(call, ['release', 'create', 'v0.0.1', '--verify-tag', '--title', 'v0.0.1', '--notes-file', file, ...assetNames(tag).map((name) => path.join(box.root, ASSETS, name))]);
  assert.equal(notes, '### Added\n\n- The first entry of 0.0.1.\n');
  assert.equal(existsSync(file), false, 'the notes file is removed');
});

test('publish without the archives fails before any request', (t) => {
  const box = sandbox(t);
  stops(() => publish(box.root, box.tag('v0.0.1')), /^var\/release\/assets lacks \[.*\]; make release-assets builds them$/);
  assert.deepEqual(box.recorded().calls, []);
});

test('the declarations cover every tracked manifest of the repository', () => {
  const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const manifests = tracked.filter((file) => ['package.json', 'composer.json', 'Cargo.toml', 'VERSION', 'pyproject.toml'].includes(path.basename(file))).sort();
  assert.deepEqual(manifests, [...MANIFESTS, ...Object.keys(NOT_RELEASED)].sort());
  assert.deepEqual(MANIFESTS.filter((file) => file in NOT_RELEASED), []);
  assert.deepEqual(tracked.filter((file) => path.basename(file) === 'go.mod').map((file) => path.dirname(file)).sort(), Object.keys(GO_MODULES).sort());
  for (const { kind, directory, name } of PACKAGES) {
    const manifest = path.join(ROOT, directory, kind === 'npm' ? 'package.json' : 'composer.json');
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).name, name, directory);
    assert.ok(MANIFESTS.includes(path.relative(ROOT, manifest)), `${directory}: its manifest is not version-checked`);
  }
});

test('the assets are npm tarballs and Composer zips, and a crate is consumed by git tag', () => {
  assert.deepEqual([...new Set(PACKAGES.map(({ kind }) => kind))].sort(), ['composer', 'npm']);
  assert.equal(GIT_TAG, 'not released as an archive; consumed by git tag');
  for (const file of [...MANIFESTS, ...Object.keys(NOT_RELEASED)].filter((file) => path.basename(file) === 'Cargo.toml')) {
    assert.equal(NOT_RELEASED[file], GIT_TAG, file);
  }
  const source = readFileSync(path.join(ROOT, 'scripts/release.mjs'), 'utf8');
  assert.ok(!source.includes("'package', '--no-verify'") && !source.includes('.crate'), 'scripts/release.mjs builds a Cargo archive');
});

test('make runs each step with the tag of the environment', () => {
  for (const step of ['verify', 'versions', 'assets', 'publish']) {
    const lines = dryRun(`release-${step}`, { env: { ...process.env, TAG: 'v0.0.1' } });
    assert.equal(lines.at(-1), `node scripts/release.mjs ${step} "$TAG"`, lines.join('\n'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', 'TAG'].includes(name)));
    const missing = spawnSync('make', ['--no-print-directory', `release-${step}`], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, new RegExp(`make release-${step} needs TAG=<tag>`));
  }
});
