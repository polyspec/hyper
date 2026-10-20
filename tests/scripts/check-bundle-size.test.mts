// Tests scripts/check-bundle-size.mts: a build whose index names no template file fails with the expected and the
// actual count instead of passing or failing with a TypeError (HR-84).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';

test('a build without template files fails with the expected and the actual count', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bundle-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ hyper: '/assets/hyper-A.js' }));
  writeFileSync(path.join(directory, 'templates.index.json'), '{}');
  writeFileSync(path.join(directory, 'limits.json'), JSON.stringify({ limits: { ssrScript: 1, csrShell: 1, chunks: 1, largestTemplate: 1 } }));
  const run = spawnSync(process.execPath, ['scripts/check-bundle-size.mts', '--app', directory, '--output', directory, '--limits', path.join(directory, 'limits.json')], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /templates\.index\.json names no template file; expected at least 1, actual 0/);
});

// A build whose outputs are all larger than their limits of 1 byte.
function oversized(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bundle-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'public', 'assets', 'templates'), { recursive: true });
  mkdirSync(path.join(directory, 'csr', 'assets'), { recursive: true });
  writeFileSync(path.join(directory, 'csr', 'assets', 'hyper-chunk-B.js'), 'export const b = "chunk";\n'.repeat(20));
  writeFileSync(path.join(directory, 'csr', 'assets', 'hyper-chunk-C.js'), 'export const c = "chunk";\n'.repeat(20));
  writeFileSync(path.join(directory, 'public', 'assets', 'hyper-A.js'), 'console.log("hyper");\n'.repeat(20));
  writeFileSync(path.join(directory, 'public', 'assets', 'templates', 'page.json'), '{"page":true}');
  writeFileSync(path.join(directory, 'csr', 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ hyper: '/assets/hyper-A.js' }));
  writeFileSync(path.join(directory, 'templates.index.json'), JSON.stringify({ page: { url: '/assets/templates/page.json' } }));
  writeFileSync(path.join(directory, 'limits.json'), JSON.stringify({ limits: { ssrScript: 1, csrShell: 1, chunks: 1, largestTemplate: 1 } }));
  return directory;
}

const measure = (directory: string, env: Record<string, string> = {}) => spawnSync(process.execPath, ['scripts/check-bundle-size.mts', '--app', directory, '--output', directory, '--limits', path.join(directory, 'limits.json')], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } });

test('a size above its limit is a warning with the size and the limit, and the measurement passes', (t) => {
  const run = measure(oversized(t));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of ['ssrScript', 'csrShell', 'chunks', 'largestTemplate']) {
    assert.match(run.stdout, new RegExp(`^WARNING ${name} .+: gzip \\d+ bytes exceed the limit 1; raw \\d+, brotli \\d+$`, 'm'));
  }
  assert.doesNotMatch(run.stdout, /::warning::/);
});

// HYC-16: the chunk files of the build, which the browser loads together when the entry first runs the code that it
// imports with import(), are one output whose size sums the sizes of its files, each compressed alone.
test('the chunk files of the static deployment are measured together as the output chunks', (t) => {
  const directory = oversized(t);
  const run = measure(directory);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const line = run.stdout.split('\n').find((text) => text.startsWith('WARNING chunks '));
  assert.ok(line, run.stdout);
  const files = ['hyper-chunk-B.js', 'hyper-chunk-C.js'].map((name) => readFileSync(path.join(directory, 'csr', 'assets', name)));
  const gzip = files.reduce((total, bytes) => total + gzipSync(bytes, { level: 9 }).length, 0);
  const raw = files.reduce((total, bytes) => total + bytes.length, 0);
  assert.match(line, /csr\/assets\/hyper-chunk-B\.js, \S+csr\/assets\/hyper-chunk-C\.js: /);
  assert.match(line, new RegExp(`: gzip ${gzip} bytes exceed the limit 1; raw ${raw}, brotli \\d+$`));
});

test('a build without chunk files fails with the expected and the actual count', (t) => {
  const directory = oversized(t);
  for (const name of readdirSync(path.join(directory, 'csr', 'assets'))) rmSync(path.join(directory, 'csr', 'assets', name));
  const run = measure(directory);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /holds no chunk file hyper-chunk-<hash>\.js; expected at least 1, actual 0/);
});

test('on GitHub Actions a size above its limit is also a warning annotation', (t) => {
  const run = measure(oversized(t), { GITHUB_ACTIONS: 'true' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^::warning title=bundle size::ssrScript: gzip \d+ bytes exceed the limit 1$/m);
});

// Performance is measured and reported, never a failure (AGENTS): the scripts that measure sizes and times end with a
// failure only for a usage error or an input that is missing, never for a measured value.
test('no script that measures performance fails on a measurement', () => {
  const scripts = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../scripts');
  const measuring = readdirSync(scripts).filter((name) => /^(bench-|check-bundle-size)/.test(name));
  assert.deepEqual(measuring.sort(), ['check-bundle-size.mts']);
  for (const name of measuring) {
    const text = readFileSync(path.join(scripts, name), 'utf8');
    assert.doesNotMatch(text, /process\.exit\(1\)|exitCode = 1|\bexit\(1\)/, `${name} ends with a failure`);
  }
});
