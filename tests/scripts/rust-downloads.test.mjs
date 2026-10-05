// Tests the check of the Rust downloads (HY-89, scripts/rust-downloads.mjs): `make ext` runs cargo offline, and the
// check before it runs `cargo fetch --locked --offline` in the crate directory, so a missing toolchain or crate fails
// with the first error line of cargo and `run make install`, never with the advice of cargo or rustup to download.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Runs the check on a crate directory with a stub cargo first on PATH, which records its arguments and its directory
// and answers with `stderr` and `status`.
function check(t, { stderr = '', status = 0 }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-rust-downloads-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const crate = path.join(directory, 'crate');
  mkdirSync(crate);
  mkdirSync(path.join(directory, 'bin'));
  writeFileSync(path.join(directory, 'stderr.txt'), stderr);
  writeFileSync(path.join(directory, 'bin', 'cargo'), `#!/bin/sh\necho "$PWD $*" > ${directory}/args.txt\ncat ${directory}/stderr.txt >&2\nexit ${status}\n`);
  chmodSync(path.join(directory, 'bin', 'cargo'), 0o755);
  const run = spawnSync(process.execPath, ['scripts/rust-downloads.mjs', crate], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${directory}/bin${path.delimiter}${process.env.PATH}` } });
  return { ...run, args: readFileSync(path.join(directory, 'args.txt'), 'utf8').trim(), crate };
}

test('the check fetches the locked crates offline in the crate directory and passes when they are present', (t) => {
  const run = check(t, {});
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.args.replace(/^\/private\//, '/'), `${run.crate.replace(/^\/private\//, '/')} fetch --locked --offline`);
  assert.match(run.stdout, /the Rust toolchain and the crates of .+crate are installed/);
});

test('a missing crate fails with the first error line of cargo and make install, without the advice to go online', (t) => {
  const run = check(t, { status: 101, stderr: 'error: failed to download `itoa v1.0.15`\n\nCaused by:\n  attempting to make an HTTP request, but --offline was specified\n\nhelp: if this error is too generic, retry without the offline flag\n' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /error: failed to download `itoa v1\.0\.15`/);
  assert.match(run.stderr, /run make install, which installs the Rust toolchain of the declared copy and downloads the crates of its Cargo\.lock/);
  assert.doesNotMatch(run.stderr, /retry|offline flag/);
});

test('a missing toolchain fails with the error line of rustup and make install, not rustup toolchain install', (t) => {
  const run = check(t, { status: 1, stderr: "error: toolchain '1.98.1-aarch64-apple-darwin' is not installed\nhelp: run `rustup toolchain install` to install it\n" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /error: toolchain '1\.98\.1-aarch64-apple-darwin' is not installed/);
  assert.match(run.stderr, /run make install/);
  assert.doesNotMatch(run.stderr, /rustup toolchain install/);
});
