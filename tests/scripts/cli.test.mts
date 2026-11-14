// Tests the one bin `hyper` of @polyspec/hyper-cli (HR-96): its subcommands build and check, and its exit codes, 0 for
// success, 2 for a usage error, an unknown subcommand or an unknown option, and 1 for a failure with its message on
// stderr.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseJsonObject } from '../../scripts/json.mts';
import { fixture } from './build-fixture.mts';
import { requireNodeAddon } from './requires.mts';

// The command tool takes its rules from the Node binding of the core (HR-96).
requireNodeAddon();

const bin = resolve('packages/cli/bin/hyper.mjs');
const hyper = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('the package has the one bin hyper (HR-96)', () => {
  const manifest = parseJsonObject(readFileSync('packages/cli/package.json', 'utf8'), 'packages/cli/package.json');
  assert.deepEqual(manifest.bin, { hyper: 'bin/hyper.mjs' });
});

test('a missing or unknown subcommand exits with 2 and the usage (HR-96)', () => {
  for (const args of [[], ['assets'], ['--app', '.']]) {
    const result = hyper(...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /usage: hyper build --app <directory> --output <directory>/);
    assert.equal(result.stdout, '');
  }
});

test('an unknown option, an argument without an option and a missing required option exit with 2 (HR-96)', (t) => {
  const app = fixture('chunks', t);
  const output = join(app, 'out');
  for (const args of [
    ['build', '--app', app, '--output', output, '--build', 'build.json'],
    ['build', '--app', app, '--output', output, '--build-id', '1'.repeat(64)],
    ['build', '--app', app, '--output', output, 'extra'],
    ['build', '--app', app],
    ['build', '--output', output],
    ['check'],
    ['check', '--app', app, '--output', output],
  ]) {
    const result = hyper(...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /^hyper: /);
  }
});

test('hyper check exits with 0 for an application that passes and 1 with every problem for one that does not (HR-96)', (t) => {
  const passes = hyper('check', '--app', fixture('chunks', t));
  assert.equal(passes.status, 0, passes.stderr);
  assert.equal(passes.stderr, '');
  const fails = hyper('check', '--app', fixture('regions', t));
  assert.equal(fails.status, 1, fails.stdout);
  assert.match(fails.stderr, /view\.tpl: places \{# lost\} 0 times, expected once \(HY-3, HY-30\)/);
});

test('hyper build exits with 0 when it builds and 1 with the message when it fails (HR-96)', (t) => {
  const app = fixture('chunks', t);
  const built = hyper('build', '--app', app, '--output', join(app, 'out'));
  assert.equal(built.status, 0, built.stderr);
  const invalid = fixture('invalid-manifest', t);
  const failed = hyper('build', '--app', invalid, '--output', join(invalid, 'out'));
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stderr, /^hyper: .*page region/);
});

test('a directory that is no application fails with 1 and its path (HR-96)', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-cli-empty-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = hyper('check', '--app', directory);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(directory), result.stderr);
});
