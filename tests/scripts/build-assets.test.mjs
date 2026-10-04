// Tests the outputs of scripts/build-assets.mjs: it checks the manifest before it writes any output (HY-2), and it
// writes the client entry, a chunk file for code that the entry imports with import(), the manifest with the entry
// URL only and a static shell without a stylesheet (HY-76).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const templateDir = resolve('..', 'template');

function buildAssets(app, ...options) {
  return spawnSync(process.execPath, ['scripts/build-assets.mjs', '--app', app, '--api', '/api', '--template-dir', templateDir, ...options], { encoding: 'utf8' });
}

test('rejects an invalid manifest and writes nothing', () => {
  const app = 'tests/scripts/fixtures/invalid-manifest';
  const result = buildAssets(app);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /page region/);
  assert.equal(existsSync(`${app}/public`), false);
  assert.equal(existsSync(`${app}/build`), false);
});

test('writes the entry, a chunk for code that the entry imports with import(), the manifest and the shell (HY-76)', () => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-chunks-'));
  try {
    cpSync('tests/scripts/fixtures/chunks', app, { recursive: true });
    const first = buildAssets(app);
    assert.equal(first.status, 0, first.stderr);
    const assets = join(app, 'public', 'assets');
    const scripts = () => readdirSync(assets).filter((name) => name.endsWith('.js')).sort();
    assert.equal(scripts().length, 2);
    const chunk = scripts().find((name) => name.startsWith('hyper-chunk-'));
    const entry = scripts().find((name) => name !== chunk);
    assert.match(entry, /^hyper-[A-Z0-9]+\.js$/);
    assert.match(chunk, /^hyper-chunk-[A-Z0-9]+\.js$/);
    // The entry loads the chunk by an absolute URL and does not contain its code.
    const code = readFileSync(join(assets, entry), 'utf8');
    assert.ok(code.includes(`import("/assets/${chunk}")`), code);
    assert.ok(!code.includes('chunk: bind the forms'), code);
    assert.ok(readFileSync(join(assets, chunk), 'utf8').includes('chunk: bind the forms'));
    assert.deepEqual(JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')), { hyper: `/assets/${entry}` });
    // The static shell inlines the entry, links and inlines no stylesheet, and the deployment has the chunk.
    const shell = readFileSync(join(app, 'dist', 'csr', 'index.html'), 'utf8');
    assert.ok(shell.includes(code), shell);
    assert.doesNotMatch(shell, /<style|<link/);
    assert.equal(readFileSync(join(app, 'dist', 'csr', 'assets', chunk), 'utf8'), readFileSync(join(assets, chunk), 'utf8'));
    // A build after a change of the chunk code replaces the chunk and leaves no earlier script.
    writeFileSync(join(app, 'client', 'forms.ts'), "export function bindForms(): void {\n  console.log('chunk: bind the forms again');\n}\n");
    const second = buildAssets(app);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(scripts().length, 2);
    assert.ok(!scripts().includes(chunk));
    assert.deepEqual(readdirSync(join(app, 'dist', 'csr', 'assets')).filter((name) => name.endsWith('.js')).sort(), scripts().filter((name) => name.startsWith('hyper-chunk-')));
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('compiles a stylesheet with the Tailwind utilities that the templates use (HY-77)', () => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-tailwind-'));
  try {
    cpSync('tests/scripts/fixtures/chunks', app, { recursive: true });
    writeFileSync(join(app, 'templates', 'home.tpl'), '<p class="md:flex gap-4">home</p>\n');
    writeFileSync(join(app, 'styles.css'), '.home {\n  color: #123456;\n}\n');
    const result = buildAssets(app, '--tailwind', 'styles.css=public/assets/app.css');
    assert.equal(result.status, 0, result.stderr);
    const css = readFileSync(join(app, 'public', 'assets', 'app.css'), 'utf8');
    assert.match(css, /^@layer theme, base, components, utilities;/m);
    // The utilities that a template uses, and no utility that no file uses.
    assert.ok(css.includes('.md\\:flex'), css);
    assert.ok(css.includes('.gap-4'), css);
    assert.ok(!css.includes('.grid-cols-3'), css);
    // The rules of the source lie unchanged in the layer components, and no rule of the layer base exists.
    assert.match(css, /@layer components\s*{\s*\.home\s*{\s*color: #123456;?\s*}\s*}/);
    assert.doesNotMatch(css, /@layer base\s*{/);
    // The static deployment holds the compiled stylesheet of the same build.
    assert.equal(readFileSync(join(app, 'dist', 'csr', 'assets', 'app.css'), 'utf8'), css);
    // A source that cannot be read fails the build.
    const missing = buildAssets(app, '--tailwind', 'missing.css=public/assets/app.css');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing\.css/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
