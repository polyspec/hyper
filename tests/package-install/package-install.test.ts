// Runs the installed hyper packages under node without a bundler, as a package that depends on them does (HR-61).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Router, stripBasePath } from '@polyspec/hyper-client';
import { App, Forbidden, MemorySessionStore, Request, Result, type Handlers, type Reply, type Response } from '@polyspec/hyper-server';

// The fixtures of the server tests: the manifest and the template files that `make node-fixtures` builds.
const FIXTURES = fileURLToPath(new URL('../../packages/server/php/tests/fixtures/', import.meta.url));
const BUILD = fileURLToPath(new URL('../../packages/server/ts/tests/build/', import.meta.url));

// The exports of each package; the browser package also exports the declaration of the template index, which an
// application build resolves to the index of its own asset build (HR-34), and the source of the reserved template
// hyper/data.tpl, which the builds of @polyspec/hyper-build read (HR-96).
const EXPORTS: Record<string, unknown> = {
  '@polyspec/hyper-client': {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './templates-index': { types: './templates-index.d.ts' },
    './data-template.json': './data-template.json',
  },
  '@polyspec/hyper-server': { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
};

// JSON.parse returns any: the test takes each JSON value as unknown and narrows the parts that it reads.
type JsonObject = { [key: string]: unknown };
const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
function jsonObject(value: unknown, where: string): JsonObject {
  if (!isJsonObject(value)) throw new TypeError(`${where} is not a JSON object`);
  return value;
}
const readObject = (file: string | URL): JsonObject => jsonObject(JSON.parse(readFileSync(file, 'utf8')), String(file));

// The directory of each package in this repository: the target of its link in the lock of this project (H23.8).
const LOCK = jsonObject(readObject(new URL('package-lock.json', import.meta.url)).packages, 'package-lock.json packages');
function linkedDirectory(name: string): string {
  const value = LOCK[`node_modules/${name}`];
  const entry = value === undefined ? undefined : jsonObject(value, `package-lock.json node_modules/${name}`);
  if (entry?.link !== true || typeof entry.resolved !== 'string') throw new Error(`package-lock.json links ${name} to no directory`);
  return fileURLToPath(new URL(`${entry.resolved}/`, import.meta.url));
}
const NPM = fileURLToPath(new URL('../../var/tools/bin/npm', import.meta.url));

test('the installed packages are the packages of this repository, JavaScript with declarations', () => {
  for (const name of ['@polyspec/hyper-client', '@polyspec/hyper-server']) {
    const directory = linkedDirectory(name);
    assert.equal(import.meta.resolve(name), pathToFileURL(join(directory, 'dist', 'index.js')).href);
    assert.deepEqual(readObject(join(directory, 'package.json')).exports, EXPORTS[name]);
    if (name === '@polyspec/hyper-client') {
      assert.equal(readObject(join(directory, 'data-template.json')).name, 'hyper/data.tpl');
    }
  }
});

test('each package publishes its build and declarations without its source', () => {
  for (const name of ['@polyspec/hyper-client', '@polyspec/hyper-server']) {
    // npm pack --dry-run lists the files that the published archive holds; npm 12 keys its JSON by the package name.
    const pack = execFileSync(NPM, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: linkedDirectory(name), encoding: 'utf8' });
    const packed: unknown = jsonObject(jsonObject(JSON.parse(pack), 'the output of npm pack')[name], `the output of npm pack ${name}`).files;
    if (!Array.isArray(packed)) throw new TypeError(`npm pack lists no files of ${name}`);
    const files = packed.map((file: unknown) => {
      const path = jsonObject(file, `a file of npm pack ${name}`).path;
      if (typeof path !== 'string') throw new TypeError(`a file of npm pack ${name} has no path`);
      return path;
    });
    const expected = ['package.json', 'dist/index.js', 'dist/index.d.ts', ...(name === '@polyspec/hyper-client' ? ['templates-index.d.ts', 'data-template.json'] : [])];
    for (const file of expected) assert.ok(files.includes(file), `${name} publishes ${file}`);
    assert.deepEqual(files.filter((file) => file.startsWith('src/')), [], `${name} publishes its source`);
  }
});

test('the browser package routes a path', () => {
  const router = new Router([{ name: 'item', path: '/items/{id}' }]);
  assert.deepEqual(router.match(stripBasePath('/api/items/7', '/api') ?? ''), { name: 'item', params: { id: '7' } });
});

test('the server package answers requests and reports the reply of each one', async () => {
  const reports: [number, Record<string, unknown>][] = [];
  const handlers: Handlers<Record<string, never>> = {
    routes: {
      add: { post: () => Result.redirect('/') },
      item: {
        load: ({ request, reply }) => {
          reply.note('refusal', 'private');
          if (request.param('id') === 'private') throw new Forbidden();
          return { id: request.param('id') };
        },
      },
    },
  };
  const app = await App.open({
    manifest: `${FIXTURES}app.json`,
    templates: { index: `${BUILD}templates.index.json`, root: BUILD },
    handlers,
    timezone: 'Z',
    onResponse: (_request: Request | null, response: Response, _elapsed: number, reply: Reply) => {
      reports.push([response.status, Object.fromEntries(reply.notes())]);
    },
  });
  const store = new MemorySessionStore();
  const page = await app.handle(Request.from({ method: 'GET', target: '/' }), store);
  assert.equal(page.status, 200);
  assert.equal(page.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(page.body, /<title>Home - Site<\/title>/);
  assert.equal((await app.handle(Request.from({ method: 'GET', target: '/items/private' }), store)).status, 403);
  assert.deepEqual(reports, [[200, {}], [403, { refusal: 'private' }]]);
});
