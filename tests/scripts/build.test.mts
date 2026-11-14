// Tests the outputs of one run of `hyper build` (HR-34, HYC-16, HY-125): below public/assets it only adds files whose
// names hold a hash of their content, it publishes client/ and program/ of --output and nothing else there, and it
// computes the build id once over the files of HY-125.15 to HY-125.17, which client/build.json, program/build.json and
// the static shell hold.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import dataTemplate from '../../packages/client/data-template.json' with { type: 'json' };
import { buildId } from '../../packages/cli/lib/build-id.mjs';
import { listFiles } from '../../packages/cli/lib/output-files.mjs';
import { jsonArray, jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { fixture, runBuild } from './build-fixture.mts';

function build(app: string, ...options: string[]) {
  const result = runBuild(app, ...options);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const readJson = (file: string) => parseJsonObject(readFileSync(file, 'utf8'), file);
const buildOf = (file: string) => jsonString(readJson(file).build, `${file} build`);

// The files that the build id hashes, read back from disk by the paths of HY-125.17: the files of assets.json, the
// files of client/ without build.json and csr/, the --static files as csr/<path>, and the files of program/ without
// build.json.
function hashedFiles(app: string, statics: string[] = []) {
  const output = join(app, 'out');
  const assets = jsonArray(readJson(join(output, 'client', 'assets.json')).files, 'assets.json files').map((path) => jsonString(path, 'assets.json path'));
  const files = assets.map((path) => ({ path, bytes: readFileSync(join(app, path)) }));
  for (const name of ['manifest.json', 'assets.json', 'templates.index.json']) files.push({ path: `client/${name}`, bytes: readFileSync(join(output, 'client', name)) });
  for (const path of statics) files.push({ path: `csr/${path}`, bytes: readFileSync(join(app, 'public', path)) });
  for (const file of listFiles(join(output, 'program'))) {
    const path = relative(join(output, 'program'), file);
    if (path !== 'build.json') files.push({ path: `program/${path}`, bytes: readFileSync(file) });
  }
  return files;
}

test('writes the outputs of HR-34 below public/assets, client/ and program/ and nothing else below --output', (t) => {
  const app = fixture('chunks', t);
  const output = join(app, 'out');
  mkdirSync(output);
  // A file of the application below --output, which the build neither reads nor removes.
  writeFileSync(join(output, 'app.json'), '{"own":true}');
  build(app, '--api', '/api', '--php-namespace', 'Fixture\\Program');
  assert.deepEqual(readdirSync(output).sort(), ['app.json', 'client', 'program']);
  assert.equal(readFileSync(join(output, 'app.json'), 'utf8'), '{"own":true}');
  assert.deepEqual(readdirSync(join(output, 'client')).sort(), ['assets.json', 'build.json', 'csr', 'manifest.json', 'templates.index.json']);
  // The intermediate files of the PHP compilation, graph/ and types.json, are not in the program.
  assert.deepEqual(readdirSync(join(output, 'program')).sort(), ['build.json', 'legacy', 'php', 'program.json', 'reads.json', 'templates']);
  assert.deepEqual(readJson(join(output, 'program', 'program.json')), { namespace: 'Fixture\\Program' });
  assert.ok(existsSync(join(output, 'program', 'php', 'GeneratedProgram.php')));
  // The reserved template is not below program/templates, which the core reads and where it refuses an application
  // template of that name (HY-31.3); its copy for a server that does not call the core is program/legacy (HY-31.10).
  assert.equal(existsSync(join(output, 'program', 'templates', 'hyper', 'data.tpl')), false);
  assert.equal(readFileSync(join(output, 'program', 'legacy', 'hyper', 'data.tpl'), 'utf8'), dataTemplate.source);
  assert.deepEqual(listFiles(join(output, 'program', 'legacy')).map((file) => relative(join(output, 'program', 'legacy'), file)), [join('hyper', 'data.tpl')]);
  // assets.json lists every file that this build wrote below public/assets, in byte order.
  const assets = jsonArray(readJson(join(output, 'client', 'assets.json')).files, 'files').map((path) => jsonString(path, 'path'));
  const written = listFiles(join(app, 'public', 'assets')).map((file) => relative(app, file)).sort();
  assert.deepEqual(assets, written);
  assert.deepEqual([...assets].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))), assets);
});

test('without --php-namespace the program holds no PHP program (HY-48.6)', (t) => {
  const app = fixture('chunks', t);
  build(app);
  assert.deepEqual(readdirSync(join(app, 'out', 'program')).sort(), ['build.json', 'legacy', 'reads.json', 'templates']);
});

test('writes the entry, a chunk for code that the entry imports with import(), the manifest and the shell (HYC-16)', (t) => {
  const app = fixture('chunks', t);
  build(app, '--api', '/api');
  const assets = join(app, 'public', 'assets');
  const client = join(app, 'out', 'client');
  const scripts = () => readdirSync(assets).filter((name) => name.endsWith('.js')).sort();
  assert.equal(scripts().length, 2);
  const chunk = scripts().find((name) => name.startsWith('hyper-chunk-'));
  const entry = scripts().find((name) => name !== chunk);
  assert.ok(chunk !== undefined && entry !== undefined, `the build wrote no entry and chunk: ${scripts().join(' ')}`);
  assert.match(entry, /^hyper-[A-Z0-9]+\.js$/);
  assert.match(chunk, /^hyper-chunk-[A-Z0-9]+\.js$/);
  // The entry loads the chunk by an absolute URL and does not contain its code.
  const code = readFileSync(join(assets, entry), 'utf8');
  assert.ok(code.includes(`import("/assets/${chunk}")`), code);
  assert.ok(!code.includes('chunk: bind the forms'), code);
  assert.deepEqual(readJson(join(client, 'manifest.json')), { hyper: `/assets/${entry}` });
  const indexFile = join(client, 'templates.index.json');
  const homeUrl = jsonString(jsonObject(readJson(indexFile)['home.tpl'], `${indexFile} home.tpl`).url, `${indexFile} home.tpl url`);
  assert.match(homeUrl, /^\/assets\/templates\/home\.[0-9a-f]{12}\.json$/);
  // The entry contains the index of the build, which it imports as @polyspec/hyper-client/templates-index.
  assert.ok(code.includes(homeUrl), code);
  const shell = readFileSync(join(client, 'csr', 'index.html'), 'utf8');
  assert.ok(shell.includes(code), shell);
  assert.equal(shell.split(`<meta name="hyper-entry" content="/assets/${entry}">`).length - 1, 1, shell);
  assert.doesNotMatch(shell, /<style|<link/);
  assert.equal(readFileSync(join(client, 'csr', 'assets', chunk), 'utf8'), readFileSync(join(assets, chunk), 'utf8'));
  // A build after a change of the chunk code and a template adds the new chunk and template file and keeps every
  // file of the earlier build, which a server or an open page of that build still loads (HR-34).
  const templateFiles = () => readdirSync(join(assets, 'templates')).sort();
  const firstTemplates = templateFiles();
  writeFileSync(join(app, 'client', 'forms.ts'), "export function bindForms(): void {\n  console.log('chunk: bind the forms again');\n}\n");
  writeFileSync(join(app, 'templates', 'home.tpl'), '<p>home again</p>\n');
  build(app, '--api', '/api');
  assert.equal(scripts().length, 4);
  assert.ok(scripts().includes(chunk) && scripts().includes(entry));
  for (const name of firstTemplates) assert.ok(templateFiles().includes(name), name);
  assert.equal(templateFiles().length, firstTemplates.length + 1);
  // The static shell of the second build holds the chunk of that build only.
  const secondChunk = scripts().find((name) => name.startsWith('hyper-chunk-') && name !== chunk);
  assert.deepEqual(readdirSync(join(client, 'csr', 'assets')).filter((name) => name.endsWith('.js')), [secondChunk]);
});

test('computes the build id once over the files of HY-125.15 to HY-125.17 and writes it into both build.json and the shell', (t) => {
  const app = fixture('chunks', t);
  mkdirSync(join(app, 'public', 'assets'), { recursive: true });
  writeFileSync(join(app, 'public', 'assets', 'app.css'), 'p {}\n');
  build(app, '--api', '/api', '--php-namespace', 'Fixture\\Program', '--static', 'public/assets/app.css');
  const client = join(app, 'out', 'client', 'build.json');
  const program = join(app, 'out', 'program', 'build.json');
  const id = buildOf(client);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(client, 'utf8'), `{"build":"${id}"}`);
  assert.equal(readFileSync(program, 'utf8'), `{"build":"${id}"}`);
  assert.equal(id, buildId(hashedFiles(app, ['assets/app.css'])));
  const shell = readFileSync(join(app, 'out', 'client', 'csr', 'index.html'), 'utf8');
  assert.equal(shell.split(`<meta name="hyper-build" content="${id}">`).length - 1, 1, shell);
  // A changed --static file gives another id (HY-125.15).
  writeFileSync(join(app, 'public', 'assets', 'app.css'), 'p { margin: 0; }\n');
  build(app, '--api', '/api', '--php-namespace', 'Fixture\\Program', '--static', 'public/assets/app.css');
  const secondId = buildOf(client);
  assert.notEqual(secondId, id);
  assert.equal(secondId, buildId(hashedFiles(app, ['assets/app.css'])));
});

test('a build that changes only a server output gives a new build id (HY-125.20)', (t) => {
  const app = fixture('chunks', t);
  build(app, '--php-namespace', 'Fixture\\Program');
  const first = buildOf(join(app, 'out', 'program', 'build.json'));
  const client = readFileSync(join(app, 'out', 'client', 'manifest.json'), 'utf8');
  build(app, '--php-namespace', 'Fixture\\Other');
  assert.equal(readFileSync(join(app, 'out', 'client', 'manifest.json'), 'utf8'), client);
  assert.notEqual(buildOf(join(app, 'out', 'program', 'build.json')), first);
  // The same inputs give the same id.
  build(app, '--php-namespace', 'Fixture\\Other');
  const again = buildOf(join(app, 'out', 'program', 'build.json'));
  build(app, '--php-namespace', 'Fixture\\Other');
  assert.equal(buildOf(join(app, 'out', 'program', 'build.json')), again);
});

test('a second build removes the files of client/ and program/ that it does not write (HR-82)', (t) => {
  const app = fixture('chunks', t);
  build(app, '--api', '/api', '--php-namespace', 'Fixture\\Program');
  build(app);
  assert.equal(existsSync(join(app, 'out', 'client', 'csr')), false);
  assert.equal(existsSync(join(app, 'out', 'program', 'php')), false);
  assert.equal(existsSync(join(app, 'out', 'program', 'program.json')), false);
  // No staging directory of the run is left.
  assert.deepEqual(readdirSync(join(app, 'out')).sort(), ['client', 'program']);
});
