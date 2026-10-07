// Tests the outputs of scripts/build-assets.mjs: it checks the manifest before it writes any output (HY-2), and it
// writes the client entry, a chunk file for code that the entry imports with import(), the manifest with the entry
// URL only and a static shell without a stylesheet (HY-76); it only adds files with a hash in their names below
// public/assets and writes its other outputs into the directory of --output (HY-34, HY-76).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { copyTracked } from '../../scripts/tracked-files.mjs';

// Copies the tracked files of a fixture application, so a file that an earlier run left in the fixture cannot decide
// the result (HY-85).
const fixture = (name, target) => copyTracked({ repository: resolve('.'), path: `tests/scripts/fixtures/${name}`, target, base: `tests/scripts/fixtures/${name}` });

function buildAssets(app, ...options) {
  return spawnSync(process.execPath, ['scripts/build-assets.mjs', '--app', app, '--api', '/api', '--output', join(app, 'out'), ...options], { encoding: 'utf8' });
}

test('rejects an invalid manifest and writes nothing', () => {
  // A copy of the fixture, so an output of an earlier run cannot decide the result (HY-85).
  const app = mkdtempSync(join(tmpdir(), 'hyper-invalid-manifest-'));
  try {
    fixture('invalid-manifest', app);
    const result = buildAssets(app);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /page region/);
    assert.equal(existsSync(`${app}/public`), false);
    assert.equal(existsSync(`${app}/out`), false);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('writes the entry, a chunk for code that the entry imports with import(), the manifest and the shell (HY-76)', () => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-chunks-'));
  try {
    fixture('chunks', app);
    const first = buildAssets(app);
    assert.equal(first.status, 0, first.stderr);
    const assets = join(app, 'public', 'assets');
    const output = join(app, 'out');
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
    // The manifest, the index and the static shell lie in the directory of --output, not below public (HY-34).
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')), { hyper: `/assets/${entry}` });
    const index = JSON.parse(readFileSync(join(output, 'templates.index.json'), 'utf8'));
    assert.match(index['home.tpl'].url, /^\/assets\/templates\/home\.[0-9a-f]{12}\.json$/);
    assert.deepEqual(readdirSync(assets).filter((name) => !name.startsWith('hyper-') && name !== 'templates'), []);
    // The entry contains the index of the build, which it imports as @polyspec/hyper/templates-index.
    assert.ok(code.includes(index['home.tpl'].url), code);
    const shell = readFileSync(join(output, 'csr', 'index.html'), 'utf8');
    assert.ok(shell.includes(code), shell);
    assert.doesNotMatch(shell, /<style|<link/);
    assert.equal(readFileSync(join(output, 'csr', 'assets', chunk), 'utf8'), readFileSync(join(assets, chunk), 'utf8'));
    // A build after a change of the chunk code and a template adds the new chunk and template file and keeps every
    // file of the earlier build, which a server or an open page of that build still loads.
    const templateFiles = () => readdirSync(join(assets, 'templates')).sort();
    const firstTemplates = templateFiles();
    writeFileSync(join(app, 'client', 'forms.ts'), "export function bindForms(): void {\n  console.log('chunk: bind the forms again');\n}\n");
    writeFileSync(join(app, 'templates', 'home.tpl'), '<p>home again</p>\n');
    const second = buildAssets(app);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(scripts().length, 4);
    assert.ok(scripts().includes(chunk) && scripts().includes(entry));
    for (const name of firstTemplates) assert.ok(templateFiles().includes(name), name);
    assert.equal(templateFiles().length, firstTemplates.length + 1);
    const secondEntry = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).hyper;
    assert.notEqual(secondEntry, `/assets/${entry}`);
    // The static shell of the second build holds the chunk of that build only.
    const secondChunk = scripts().find((name) => name.startsWith('hyper-chunk-') && name !== chunk);
    assert.deepEqual(readdirSync(join(output, 'csr', 'assets')).filter((name) => name.endsWith('.js')), [secondChunk]);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('compiles a stylesheet with the Tailwind utilities that the templates use (HY-77)', () => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-tailwind-'));
  try {
    fixture('chunks', app);
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
    // The static deployment holds no stylesheet: the application copies the stylesheets that its layouts link.
    assert.equal(existsSync(join(app, 'out', 'csr', 'assets', 'app.css')), false);
    // The static deployment holds the files that --static names, at their paths below public/ (HY-76).
    const named = buildAssets(app, '--tailwind', 'styles.css=public/assets/app.css', '--static', 'public/assets/app.css');
    assert.equal(named.status, 0, named.stderr);
    assert.equal(readFileSync(join(app, 'out', 'csr', 'assets', 'app.css'), 'utf8'), readFileSync(join(app, 'public', 'assets', 'app.css'), 'utf8'));
    const outside = buildAssets(app, '--static', 'styles.css');
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /--static styles\.css is not below public\//);
    // A source that cannot be read fails the build.
    const missing = buildAssets(app, '--tailwind', 'missing.css=public/assets/app.css');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing\.css/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
