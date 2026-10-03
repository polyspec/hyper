// Proves that the browser code renders the same bytes as the PHP server (HY-12, HY-13, HY-20, HY-30, HY-31), and
// with --node-port that the Node server answers every request as the PHP server does (HY-55).
// It starts the application with an empty database and runs the steps of a request file in one
// session; a cookie step sets the hy-keep cookie of HY-39. For every compare step it requests:
//   1. the HTML document, rendered by PHP,
//   2. the document JSON, rendered by the browser code into a document,
//   3. the region JSON, rendered by the browser code into a title and regions,
// and requires that (2) equals (1) byte for byte and that every part of (3) appears in (1).
// Rendering also requires that the browser router selects the route that the server reported.
//
// With --node-port it also starts the board Node server (`make node-server`) with its own empty database and
// session, sends every request of the steps to both servers, and requires the same status, the same headers and
// the same body after it replaces the session identifier, the masked CSRF token and the ETag value with placeholders.
// Both servers store posts with the same creation time (BOARD_TIME).
//
// Usage: node scripts/check-parity.mjs --app examples/board --requests examples/board/tests/parity/requests.json --port 8092
//          [--extension build/ext/release/libpolyspec_template.dylib] [--node-port 8096]

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

// --extension loads the native template extension into PHP, so the server renders with it instead of the
// generated program (HY-48).
const { values } = parseArgs({ options: { app: { type: 'string' }, requests: { type: 'string' }, port: { type: 'string' }, extension: { type: 'string' }, 'node-port': { type: 'string' } } });
if (!values.app || !values.requests || !values.port) throw new Error('--app, --requests and --port are required');
const app = values.app;
const SESSION_COOKIE = 'hy-session';
// The creation time of every post: 2026-10-01 12:00:00 UTC.
const BOARD_TIME = '1790856000';
// Headers that the HTTP server program writes by itself and that the comparison leaves out (HY-55).
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'host', 'x-powered-by']);
const { steps } = JSON.parse(readFileSync(values.requests, 'utf8'));

const browser = await loadBrowserCode();
const index = JSON.parse(readFileSync(join(app, 'build', 'templates.index.json'), 'utf8'));
const application = browser.createApplication(
  JSON.parse(readFileSync(join(app, 'app', 'app.json'), 'utf8')),
  index,
  async (url) => JSON.parse(readFileSync(join(app, 'public', url), 'utf8')),
);
await application.templates.ensure(Object.keys(index));

const extension = values.extension ? ['-d', `extension=${resolve(values.extension)}`] : [];
// The renderer selects the native extension exactly when PHP has loaded it (RendererTest), so this proves the engine.
const loaded = spawnSync('php', [...extension, '-r', "exit(extension_loaded('polyspec_template') ? 0 : 1);"]).status === 0;
if (loaded !== Boolean(values.extension)) throw new Error(`PHP ${loaded ? 'loaded' : 'did not load'} the native template extension`);
console.log(`template program: ${loaded ? 'native extension' : 'generated PHP'}`);

const files = [];
const children = [];
const php = client(`http://127.0.0.1:${values.port}`);
const phpDatabase = resolve(app, 'var', 'parity.db');
files.push(phpDatabase);
rmSync(phpDatabase, { force: true });
children.push(spawn('php', [...extension, '-d', 'display_errors=0', '-S', `127.0.0.1:${values.port}`, '-t', join(app, 'public')], {
  env: { ...process.env, BOARD_DB: phpDatabase, BOARD_BASE_PATH: '', BOARD_TIME },
  stdio: 'ignore',
}));
let node = null;
if (values['node-port']) {
  node = client(`http://127.0.0.1:${values['node-port']}`);
  const nodeDatabase = resolve(app, 'var', 'parity-node.db');
  const sessions = resolve(app, 'var', 'parity-sessions');
  files.push(nodeDatabase, sessions);
  rmSync(nodeDatabase, { force: true });
  rmSync(sessions, { recursive: true, force: true });
  children.push(spawn(process.execPath, [join(app, 'build', 'node', 'server.mjs')], {
    env: { ...process.env, BOARD_DB: nodeDatabase, BOARD_SESSIONS: sessions, BOARD_PORT: values['node-port'], BOARD_BASE_PATH: '', BOARD_TIME },
    stdio: ['ignore', 'ignore', 'inherit'],
  }));
}

let failures = 0;
let compared = 0;
try {
  await Promise.all([php, node].filter((item) => item !== null).map((item) => waitForServer(item.base)));
  let keepCookie = '';
  // Sends a step to the PHP server, and to the Node server when it runs, and compares the two responses.
  const send = async (step, headers) => {
    const response = await php.send(step, headers, keepCookie);
    if (node !== null) compare(`${step.method} ${step.path} ${JSON.stringify(headers)}`, response, await node.send(step, headers, keepCookie));
    return response;
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
      const routed = application.router.match(new URL(step.path, php.base).pathname);
      if (html.status !== step.status || json.status !== step.status) fail(`${label}: statuses ${html.status} and ${json.status}, expected ${step.status}`);
      console.log(`${failures === 0 ? 'ok' : 'checked'} ${label}: ${html.status}, browser route ${routed?.name ?? 'none'}`);
      continue;
    }

    const path = new URL(step.path, php.base).pathname;
    const html = await send(step, {});
    const documentJson = await send(step, { Accept: 'application/json' });
    const regionJson = await send(step, { Accept: 'application/json', 'HX-Request': 'true', 'HX-Current-URL': php.base + step.currentPath });
    if (html.status !== documentJson.status || html.status !== regionJson.status) {
      fail(`${label}: statuses ${html.status}, ${documentJson.status}, ${regionJson.status}`);
    }

    // Every response masks the session token anew (HY-24), so each text has the masked token of its own response
    // replaced by <csrf> before the comparison.
    const server = placeholder(html.text, html.token);
    const rendered = placeholder(browser.renderDocument(application, browser.decodeResponse(application, browser.parseJson(documentJson.text), path)), documentJson.token);
    if (rendered !== server) fail(`${label}: browser document differs\n--- browser\n${rendered}\n--- server\n${server}`);

    const parts = browser.renderParts(application, browser.decodeResponse(application, browser.parseJson(regionJson.text), path));
    if (!server.includes(`<title>${parts.title}</title>`)) fail(`${label}: document does not contain the title ${parts.title}`);
    for (const [name, alone] of parts.regions) {
      const region = placeholder(alone, regionJson.token);
      const tag = new RegExp(`<([a-z]+) id="${name}">`).exec(server)?.[1];
      if (tag === undefined || !server.includes(`<${tag} id="${name}">${region}</${tag}>`)) {
        fail(`${label}: region ${name} differs\n--- browser\n${region}\n--- server\n${server}`);
      }
    }
    console.log(`${failures === 0 ? 'ok' : 'checked'} ${label}: ${html.status}, route ${parts.route.name}, document ${Buffer.byteLength(rendered)} bytes, regions ${[...parts.regions.keys()].join(', ')}`);
  }
  if (node !== null) console.log(`${failures === 0 ? 'ok' : 'checked'} Node server: ${compared} responses equal the PHP responses`);
} finally {
  for (const child of children) child.kill();
  for (const file of files) rmSync(file, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`${failures} parity failure(s)`);
  process.exit(1);
}

// A client of one server with its own session cookie and CSRF token.
function client(base) {
  const state = { base, cookie: '', token: '' };
  state.send = async (step, headers, keepCookie) => {
    // A step may add a field `pad` of that many bytes and send the form with another Content-Type (HY-59).
    const fields = step.pad === undefined ? step.form : { ...step.form, pad: 'a'.repeat(step.pad) };
    const body = fields === undefined ? undefined : new URLSearchParams({ _csrf: state.token, ...fields });
    const cookies = [state.cookie, keepCookie].filter((item) => item !== '').join('; ');
    const type = step.contentType === undefined ? {} : { 'Content-Type': step.contentType };
    const response = await fetch(base + step.path, { method: step.method, headers: { ...headers, ...type, ...(cookies ? { Cookie: cookies } : {}) }, body, redirect: 'manual' });
    const session = response.headers.getSetCookie().find((item) => item.startsWith(`${SESSION_COOKIE}=`));
    if (session !== undefined) state.cookie = session.split(';')[0];
    const text = await response.text();
    state.token = /name="_csrf" value="([^"]+)"/.exec(text)?.[1] ?? /"csrf":"([^"]+)"/.exec(text)?.[1] ?? state.token;
    return { status: response.status, headers: response.headers, text, token: state.token };
  };
  return state;
}

// Compares a PHP response and a Node response after the placeholders of HY-55 replace the values that differ by
// session.
function compare(label, expected, actual) {
  compared++;
  const a = normalize(label, 'PHP', expected);
  const b = normalize(label, 'Node', actual);
  if (expected.status !== actual.status) fail(`${label}: Node status ${actual.status}, PHP status ${expected.status}`);
  if (a.headers.join('\n') !== b.headers.join('\n')) fail(`${label}: headers differ\n--- PHP\n${a.headers.join('\n')}\n--- Node\n${b.headers.join('\n')}`);
  if (a.text !== b.text) fail(`${label}: bodies differ\n--- PHP\n${a.text}\n--- Node\n${b.text}`);
}

function normalize(label, server, response) {
  const replace = (text) => (response.token === '' ? text : text.replaceAll(response.token, '<csrf>'));
  const headers = [];
  for (const [name, value] of response.headers) {
    if (TRANSPORT_HEADERS.has(name) || name === 'set-cookie') continue;
    if (name === 'etag') {
      // HY-53: the weak tag of the body with the masked token of the response replaced by the session token, which
      // the masked value gives as its second half XOR its first half (HY-24).
      const text = response.token === '' ? response.text : response.text.replaceAll(response.token, unmask(response.token));
      const tag = `W/"${createHash('sha256').update(text).digest('hex').slice(0, 32)}"`;
      // A 304 has no body; its tag is the tag of the 200 body that the request named.
      if (response.status !== 304 && value !== tag) fail(`${label}: ${server} ETag ${value} is not the tag of its body`);
      headers.push(`${name}: <etag>`);
      continue;
    }
    headers.push(`${name}: ${replace(value)}`);
  }
  for (const cookie of response.headers.getSetCookie()) {
    headers.push(`set-cookie: ${cookie.startsWith(`${SESSION_COOKIE}=`) ? cookie.replace(/^[^;]*/, `${SESSION_COOKIE}=<session>`) : replace(cookie)}`);
  }
  return { headers: headers.sort(), text: replace(response.text) };
}

// Returns a text with a masked token replaced by <csrf>.
function placeholder(text, token) {
  return token === '' ? text : text.replaceAll(token, '<csrf>');
}

// Returns the session token of a masked value (HY-24).
function unmask(masked) {
  const mask = Buffer.from(masked.slice(0, 64), 'hex');
  return Buffer.from(Buffer.from(masked.slice(64), 'hex').map((byte, index) => byte ^ mask[index])).toString('hex');
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

async function waitForServer(base) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(base + '/missing', { redirect: 'manual' });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error(`server did not start on ${base}`);
}
