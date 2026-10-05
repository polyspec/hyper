#!/usr/bin/env node
// Checks that the Rust toolchain and the crates of a crate directory are installed before a recipe runs cargo offline
// (HY-89): `cargo fetch --locked --offline` in the directory reads no network, selects the toolchain of the
// rust-toolchain.toml above it and fails on a missing toolchain or crate. cargo answers a missing crate with the advice
// to retry without --offline, and rustup a missing toolchain with `rustup toolchain install`; neither is the fix of a
// check, so this check prints the first error line and names `make install-rust`, which installs both. `make ext` runs it
// first.
//
// Usage: node scripts/rust-downloads.mjs <crate directory>
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [directory] = process.argv.slice(2);
if (!directory) {
  console.error('Usage: node scripts/rust-downloads.mjs <crate directory>');
  process.exit(2);
}
const crate = resolve(directory);
const fetch = spawnSync('cargo', ['fetch', '--locked', '--offline'], { cwd: crate, encoding: 'utf8' });
if (fetch.error || fetch.status !== 0) {
  const cause = fetch.error?.message ?? `${fetch.stderr}${fetch.stdout}`.split('\n').find((line) => line.startsWith('error')) ?? `cargo fetch --locked --offline exited with ${fetch.status}`;
  console.error(`the Rust toolchain or a crate of ${crate} is not installed: ${cause}\nrun make install-rust, which installs the Rust toolchain of the declared copy and downloads the crates of its Cargo.lock`);
  process.exit(1);
}
console.log(`[rust-downloads] the Rust toolchain and the crates of ${crate} are installed`);
