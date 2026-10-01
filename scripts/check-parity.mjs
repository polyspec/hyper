// Proves that the browser code renders the same bytes as the PHP server (HY-12, HY-13, HY-20, HY-30, HY-31).
// It starts the application with an empty database and runs the steps of a request file in one
// session; a cookie step sets the hy-keep cookie of HY-39. For every compare step it requests:
//   1. the HTML document, rendered by PHP,
//   2. the document JSON, rendered by the browser code into a document,
//   3. the region JSON, rendered by the browser code into a title and regions,
// and requires that (2) equals (1) byte for byte and that every part of (3) appears in (1).
// Rendering also requires that the browser router selects the route that the server reported.
//
// Usage: node scripts/check-parity.mjs --app examples/board --requests examples/board/tests/parity/requests.json --port 8092

import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const { values } = parseArgs({ options: { app: { type: 'string' }, requests: { type: 'string' }, port: { type: 'string' } } });
if (!values.app || !values.requests || !values.port) throw new Error('--app, --requests and --port are required');
const app = values.app;
const base = `http://127.0.0.1:${values.port}`;
const database = resolve(app, 'var', 'parity.db');
const { steps } = JSON.parse(readFileSync(values.requests, 'utf8'));

const browser = await loadBrowserCode();
const index = JSON.parse(readFileSync(join(app, 'build', 'templates.index.json'), 'utf8'));
const application = browser.createApplication(
  JSON.parse(readFileSync(join(app, 'app', 'app.json'), 'utf8')),
  index,
  async (url) => JSON.parse(readFileSync(join(app, 'public', url), 'utf8')),
);
await application.templates.ensure(Object.keys(index));

rmSync(database, { force: true });
const server = spawn('php', ['-d', 'display_errors=0', '-S', `127.0.0.1:${values.port}`, '-t', join(app, 'public')], {
  env: { ...process.env, BOARD_DB: database, BOARD_BASE_PATH: '' },
  stdio: 'ignore',
});
let failures = 0;
try {
  await waitForServer();
  let cookie = '';
  let keepCookie = '';
  let token = '';
  const send = async (step, headers) => {
    const body = step.form === undefined ? undefined : new URLSearchParams({ _csrf: token, ...step.form });
    const cookies = [cookie, keepCookie].filter((item) => item !== '').join('; ');
    const response = await fetch(base + step.path, { method: step.method, headers: { ...headers, ...(cookies ? { Cookie: cookies } : {}) }, body, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    token = /name="_csrf" value="([^"]+)"/.exec(text)?.[1] ?? /"csrf":"([^"]+)"/.exec(text)?.[1] ?? token;
    return { status: response.status, type: response.headers.get('content-type') ?? '', text };
  };

  await send({ method: 'GET', path: '/' }, {});
  for (const step of steps) {
    const label = `${step.method} ${step.path}`;
    if (step.action === 'send') {
      await send(step, {});
      continue;
    }
    if (step.action === 'cookie') {
      keepCookie = `hy-keep=${encodeURIComponent(step.value)}`;
      continue;
    }
    if (step.action === 'status') {
      const html = await send(step, {});
      const json = await send(step, { Accept: 'application/json' });
      const routed = application.router.match(new URL(step.path, base).pathname);
      if (html.status !== step.status || json.status !== step.status) fail(`${label}: statuses ${html.status} and ${json.status}, expected ${step.status}`);
      console.log(`${failures === 0 ? 'ok' : 'checked'} ${label}: ${html.status}, browser route ${routed?.name ?? 'none'}`);
      continue;
    }

    const path = new URL(step.path, base).pathname;
    const html = await send(step, {});
    const documentJson = await send(step, { Accept: 'application/json' });
    const regionJson = await send(step, { Accept: 'application/json', 'Hy-Region': 'content', 'HX-Current-URL': base + step.currentPath });
    if (html.status !== documentJson.status || html.status !== regionJson.status) {
      fail(`${label}: statuses ${html.status}, ${documentJson.status}, ${regionJson.status}`);
    }

    const rendered = browser.renderDocument(application, browser.decodeResponse(application, browser.parseJson(documentJson.text), path));
    if (rendered !== html.text) fail(`${label}: browser document differs\n--- browser\n${rendered}\n--- server\n${html.text}`);

    const parts = browser.renderParts(application, browser.decodeResponse(application, browser.parseJson(regionJson.text), path));
    if (!html.text.includes(`<title>${parts.title}</title>`)) fail(`${label}: document does not contain the title ${parts.title}`);
    for (const [name, region] of parts.regions) {
      const tag = new RegExp(`<([a-z]+) id="${name}" hy-region>`).exec(html.text)?.[1];
      if (tag === undefined || !html.text.includes(`<${tag} id="${name}" hy-region>${region}</${tag}>`)) {
        fail(`${label}: region ${name} differs\n--- browser\n${region}\n--- server\n${html.text}`);
      }
    }
    console.log(`${failures === 0 ? 'ok' : 'checked'} ${label}: ${html.status}, route ${parts.route.name}, document ${Buffer.byteLength(rendered)} bytes, regions ${[...parts.regions.keys()].join(', ')}`);
  }
} finally {
  server.kill();
  rmSync(database, { force: true });
}
if (failures > 0) {
  console.error(`${failures} parity failure(s)`);
  process.exit(1);
}

function fail(message) {
  failures++;
  console.error(`FAIL ${message}`);
}

async function loadBrowserCode() {
  const result = await build({
    stdin: {
      contents: "export { createApplication, decodeResponse, renderDocument, renderParts } from '@polyspec/hyper'; export { parseJson } from '@polyspec/template/render';",
      resolveDir: resolve('packages', 'hyper-js'),
      sourcefile: 'parity-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
  });
  const code = Buffer.from(result.outputFiles[0].contents).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(base + '/', { redirect: 'manual' });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error(`server did not start on ${base}`);
}
