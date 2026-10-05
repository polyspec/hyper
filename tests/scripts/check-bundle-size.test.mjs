// Tests scripts/check-bundle-size.mjs: a build whose index names no template file fails with the expected and the
// actual count instead of passing or failing with a TypeError (HY-84).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('a build without template files fails with the expected and the actual count', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bundle-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ hyper: '/assets/hyper-A.js' }));
  writeFileSync(path.join(directory, 'templates.index.json'), '{}');
  writeFileSync(path.join(directory, 'limits.json'), JSON.stringify({ limits: { ssrScript: 1, csrShell: 1, largestTemplate: 1 } }));
  const run = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs', '--app', directory, '--output', directory, '--limits', path.join(directory, 'limits.json')], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /templates\.index\.json names no template file; expected at least 1, actual 0/);
});

// A build whose outputs are all larger than their limits of 1 byte.
function oversized(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bundle-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'public', 'assets', 'templates'), { recursive: true });
  mkdirSync(path.join(directory, 'csr'));
  writeFileSync(path.join(directory, 'public', 'assets', 'hyper-A.js'), 'console.log("hyper");\n'.repeat(20));
  writeFileSync(path.join(directory, 'public', 'assets', 'templates', 'page.json'), '{"page":true}');
  writeFileSync(path.join(directory, 'csr', 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ hyper: '/assets/hyper-A.js' }));
  writeFileSync(path.join(directory, 'templates.index.json'), JSON.stringify({ page: { url: '/assets/templates/page.json' } }));
  writeFileSync(path.join(directory, 'limits.json'), JSON.stringify({ limits: { ssrScript: 1, csrShell: 1, largestTemplate: 1 } }));
  return directory;
}

const measure = (directory, env = {}) => spawnSync(process.execPath, ['scripts/check-bundle-size.mjs', '--app', directory, '--output', directory, '--limits', path.join(directory, 'limits.json')], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', ...env } });

test('a size above its limit is a warning with the size and the limit, and the measurement passes', (t) => {
  const run = measure(oversized(t));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of ['ssrScript', 'csrShell', 'largestTemplate']) {
    assert.match(run.stdout, new RegExp(`^WARNING ${name} \\S+: gzip \\d+ bytes exceed the limit 1; raw \\d+, brotli \\d+$`, 'm'));
  }
  assert.doesNotMatch(run.stdout, /::warning::/);
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
  assert.deepEqual(measuring.sort(), ['bench-browser.mjs', 'bench-server.php', 'check-bundle-size.mjs']);
  for (const name of measuring) {
    const text = readFileSync(path.join(scripts, name), 'utf8');
    assert.doesNotMatch(text, /process\.exit\(1\)|exitCode = 1|\bexit\(1\)/, `${name} ends with a failure`);
  }
});
