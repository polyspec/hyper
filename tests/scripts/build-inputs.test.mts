// Tests the input directory and the options of `hyper build` (HR-96, HR-77, HYC-16.12, HYC-16.13): every option, the
// manifest (HY-2) and the template rules (HY-48.3) are checked before the build writes any output, an asset keeps its
// bytes below a name with a hash of its content, and an application without client/main.ts builds its program.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { jsonArray, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { fixture, runBuild } from './build-fixture.mts';
import { requireNodeAddon } from './requires.mts';

// The command tool takes its rules from the Node binding of the core (HR-96).
requireNodeAddon();

const build = runBuild;

/** Expects the build to fail with 1, a message that matches `message`, and no output: no public/ and no out/. */
function refuses(app: string, options: string[], message: RegExp): void {
  const result = build(app, ...options);
  assert.equal(result.status, 1, `${options.join(' ')}: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, message);
  assert.equal(existsSync(join(app, 'public')), false, `${options.join(' ')} wrote public/`);
  assert.equal(existsSync(join(app, 'out')), false, `${options.join(' ')} wrote out/`);
}

test('an invalid manifest and a template that breaks a rule fail before any output (HY-2, HY-48.3)', (t) => {
  refuses(fixture('invalid-manifest', t), [], /page region/);
  refuses(fixture('regions', t), [], /view\.tpl: places \{# lost\} 0 times, expected once \(HY-3, HY-30\)/);
});

test('an asset name that breaks HYC-16.13 or that two assets share fails before any output', (t) => {
  const app = fixture('chunks', t);
  writeFileSync(join(app, 'styles.css'), '.a { color: red; }\n');
  writeFileSync(join(app, 'logo.svg'), '<svg/>');
  for (const name of ['hyper', 'hyper-logo', 'Logo', '1logo', 'logo_x', 'logo.svg']) {
    refuses(app, ['--asset', `${name}=logo.svg`], /HYC-16\.13/);
  }
  refuses(app, ['--asset', 'logo=logo.svg', '--asset', 'logo=styles.css'], /logo is given twice/);
  refuses(app, ['--asset', 'app=logo.svg', '--tailwind', 'styles.css=app'], /app is given twice/);
  refuses(app, ['--asset', 'logo'], /--asset logo is not <name>=<path>/);
  refuses(app, ['--tailwind', 'styles.css'], /--tailwind styles\.css is not <source>=<name>/);
});

test('an input path outside the application or without a file fails before any output', (t) => {
  const app = fixture('chunks', t);
  refuses(app, ['--asset', 'logo=../logo.svg'], /--asset \.\.\/logo\.svg is not a path inside the application/);
  refuses(app, ['--asset', `logo=${join(app, 'app', 'app.json')}`], /is not a path inside the application/);
  refuses(app, ['--asset', 'logo=missing.svg'], /--asset missing\.svg names no file/);
  refuses(app, ['--tailwind', 'missing.css=app'], /--tailwind missing\.css names no file/);
  refuses(app, ['--api', '/api', '--static', 'public/missing.css'], /--static public\/missing\.css names no file/);
  refuses(app, ['--api', '/api', '--static', 'styles.css'], /--static styles\.css is not below public\//);
});

test('--api needs client/main.ts, and --static needs the shell of client/main.ts and --api (HR-96)', (t) => {
  const app = fixture('chunks', t);
  mkdirSync(join(app, 'files'));
  writeFileSync(join(app, 'files', 'app.css'), 'p {}\n');
  refuses(app, ['--static', 'files/app.css'], /--static files\/app\.css needs the static shell/);
  rmSync(join(app, 'client'), { recursive: true });
  refuses(app, ['--api', '/api'], /--api \/api needs the client entry/);
});

test('an asset keeps its bytes below a name with a hash of its content, in the manifest, the shell and assets.json (HYC-16.12)', (t) => {
  const app = fixture('chunks', t);
  mkdirSync(join(app, 'images'));
  writeFileSync(join(app, 'images', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const result = build(app, '--api', '/api', '--asset', 'logo=images/logo.svg');
  assert.equal(result.status, 0, result.stderr);
  const manifestFile = join(app, 'out', 'client', 'manifest.json');
  const manifest = parseJsonObject(readFileSync(manifestFile, 'utf8'), manifestFile);
  assert.deepEqual(Object.keys(manifest), ['hyper', 'logo']);
  const url = jsonString(manifest.logo, `${manifestFile} logo`);
  assert.match(url, /^\/assets\/logo\.[0-9a-f]{12}\.svg$/);
  const name = url.slice('/assets/'.length);
  assert.equal(readFileSync(join(app, 'public', 'assets', name), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(readFileSync(join(app, 'out', 'client', 'csr', 'assets', name), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const assetsFile = join(app, 'out', 'client', 'assets.json');
  assert.ok(jsonArray(parseJsonObject(readFileSync(assetsFile, 'utf8'), assetsFile).files, `${assetsFile} files`).includes(`public/assets/${name}`));
  // The application file itself is not changed or moved.
  assert.equal(readFileSync(join(app, 'images', 'logo.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

test('--tailwind compiles a stylesheet with the utilities that the templates use into an asset of its name (HR-77)', (t) => {
  const app = fixture('chunks', t);
  writeFileSync(join(app, 'templates', 'home.tpl'), '<p class="md:flex gap-4">home</p>\n');
  writeFileSync(join(app, 'styles.css'), '.home {\n  color: #123456;\n}\n');
  const result = build(app, '--api', '/api', '--tailwind', 'styles.css=app');
  assert.equal(result.status, 0, result.stderr);
  const manifestFile = join(app, 'out', 'client', 'manifest.json');
  const url = jsonString(parseJsonObject(readFileSync(manifestFile, 'utf8'), manifestFile).app, `${manifestFile} app`);
  assert.match(url, /^\/assets\/app\.[0-9a-f]{12}\.css$/);
  const css = readFileSync(join(app, 'public', url.slice(1)), 'utf8');
  assert.match(css, /^@layer theme, base, components, utilities;/m);
  // The utilities that a template uses, and no utility that no file uses.
  assert.ok(css.includes('.md\\:flex'), css);
  assert.ok(css.includes('.gap-4'), css);
  assert.ok(!css.includes('.grid-cols-3'), css);
  // The rules of the source lie unchanged in the layer components, and no rule of the layer base exists.
  assert.match(css, /@layer components\s*{\s*\.home\s*{\s*color: #123456;?\s*}\s*}/);
  assert.doesNotMatch(css, /@layer base\s*{/);
  // No output has a fixed path: the application directory holds no compiled stylesheet besides the hashed asset.
  assert.deepEqual(readdirSync(join(app, 'public', 'assets')).filter((file) => file.endsWith('.css')), [url.slice('/assets/'.length)]);
  assert.equal(readFileSync(join(app, 'out', 'client', 'csr', 'assets', url.slice('/assets/'.length)), 'utf8'), css);
});

test('a --static file joins the shell at its path below public/ (HYC-16.7)', (t) => {
  const app = fixture('chunks', t);
  mkdirSync(join(app, 'public', 'assets'), { recursive: true });
  writeFileSync(join(app, 'public', 'assets', 'app.css'), 'p { margin: 0; }\n');
  const result = build(app, '--api', '/api', '--static', 'public/assets/app.css');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(app, 'out', 'client', 'csr', 'assets', 'app.css'), 'utf8'), 'p { margin: 0; }\n');
});

test('an application without client/main.ts builds its program and its template files, no entry and no shell (HR-34)', (t) => {
  const app = fixture('chunks', t);
  rmSync(join(app, 'client'), { recursive: true });
  const result = build(app);
  assert.equal(result.status, 0, result.stderr);
  const manifestFile = join(app, 'out', 'client', 'manifest.json');
  assert.deepEqual(parseJsonObject(readFileSync(manifestFile, 'utf8'), manifestFile), {});
  assert.equal(existsSync(join(app, 'out', 'client', 'csr')), false);
  assert.ok(existsSync(join(app, 'out', 'program', 'reads.json')));
  assert.ok(readdirSync(join(app, 'public', 'assets', 'templates')).some((file) => file.startsWith('home.')));
  assert.deepEqual(readdirSync(join(app, 'public', 'assets')).filter((file) => file.endsWith('.js')), []);
});
