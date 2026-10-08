// Proves that the browser code renders the same bytes as the PHP server (HY-12, HY-13, HY-20, HY-30, HY-31), and
// with --node or --python that the Node or the Python server answers every request as the PHP server does
// (HY-55).
// It starts the application with an empty database and runs the steps of a request file in one
// session; a cookie step sets the hy-keep cookie of HY-39. For every compare step it requests:
//   1. the HTML document, rendered by PHP,
//   2. the document JSON, rendered by the browser code into a document,
//   3. the region JSON, rendered by the browser code into a title and regions,
// and requires that (2) equals (1) byte for byte and that every part of (3) appears in (1).
// Rendering also requires that the browser router selects the route that the server reported.
//
// With --node or --python it also starts the board Node server (`make node-server`) or the board Python server
// (examples/board/python) with its own empty database and session, sends every request of the steps to both
// servers, and requires the same status, the same headers and the same body after it replaces the session
// identifier, the masked CSRF token and the ETag value with placeholders. The servers store posts with the same
// creation time (BOARD_TIME).
//
// The servers of a run listen on ports that the system assigns, and the check sends its requests to the address
// that each server reports in its output (scripts/board-servers.mjs), so it never tests a server of another run.
// Their databases and the session directory lie in a temporary directory of the run, which the check removes.
//
// Every step prints a line when it starts and its result with the elapsed milliseconds. A request without a response
// within REQUEST_TIMEOUT_MS fails by the name of its step and ends the check.
//
// Usage: node scripts/check-parity.mjs --app examples/board --requests examples/board/tests/parity/requests.json
//          [--extension build/ext/polyspec_template.so] [--node] [--python]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { serverRun, startNode, startPhp, startPython } from './board-servers.mjs';

// --extension loads the native template extension into PHP, so the server renders with it instead of the
// generated program (HY-48).
const { values } = parseArgs({ options: { app: { type: 'string' }, requests: { type: 'string' }, extension: { type: 'string' }, node: { type: 'boolean' }, python: { type: 'boolean' } } });
if (!values.app || !values.requests) throw new Error('--app and --requests are required');
const app = values.app;
const SESSION_COOKIE = 'hy-session';
// The creation time of every post: 2026-10-01 12:00:00 UTC.
const BOARD_TIME = '1790856000';
// Headers that the HTTP server program writes by itself and that the comparison leaves out (HY-55): the
// X-Powered-By of the PHP built-in server and the Server of the Python http.server.
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'host', 'x-powered-by', 'server']);
// The time in which a server answers a request of a step, its whole body included.
const REQUEST_TIMEOUT_MS = 10_000;
const { steps } = JSON.parse(readFileSync(values.requests, 'utf8'));
// A request file without a status or a compare step would pass without checking anything (HY-84).
const checks = steps.filter((step) => step.action === 'status' || step.action === 'compare').length;
if (checks === 0) throw new Error(`${values.requests} holds no status or compare step; expected at least 1, actual 0 of ${steps.length} steps`);

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

// The databases and the session directory of the run.
const run = serverRun('hyper-parity-');
console.log(`run directory: ${run.directory}`);
const { children } = run;
let php = null;
let node = null;
let python = null;
let failures = 0;
let compared = 0;
try {
  const phpServer = await startPhp({ name: 'php', app, port: 0, extension: values.extension, env: { BOARD_DB: join(run.directory, 'php.db'), BOARD_BASE_PATH: '', BOARD_TIME }, children });
  php = client(phpServer.url);
  if (values.node) {
    const nodeServer = await startNode({ name: 'node', app, port: 0, env: { BOARD_DB: join(run.directory, 'node.db'), BOARD_SESSIONS: join(run.directory, 'sessions'), BOARD_BASE_PATH: '', BOARD_TIME }, children });
    node = client(nodeServer.url);
  }
  if (values.python) {
    const pythonServer = await startPython({ name: 'python', app, port: 0, env: { BOARD_DB: join(run.directory, 'python.db'), BOARD_SESSIONS: join(run.directory, 'python-sessions'), BOARD_BASE_PATH: '', BOARD_TIME }, children });
    python = client(pythonServer.url);
  }
  let keepCookie = '';
  // Sends a step to the PHP server, and to the Node server when it runs, and compares the two responses.
  const send = async (step, headers) => {
    const response = await php.send(step, headers, keepCookie);
    if (node !== null) compare(`${step.method} ${step.path} ${JSON.stringify(headers)}`, response, await node.send(step, headers, keepCookie), 'Node');
    if (python !== null) compare(`${step.method} ${step.path} ${JSON.stringify(headers)}`, response, await python.send(step, headers, keepCookie), 'Python');
    return response;
  };

  // Every request step prints a line when it starts and its result with the elapsed milliseconds. A step that
  // throws, such as a request without a response within REQUEST_TIMEOUT_MS, fails by its name and ends the check,
  // because the later steps depend on the session of the earlier ones.
  for (const step of [{ action: 'send', method: 'GET', path: '/' }, ...steps]) {
    if (step.action === 'cookie') {
      keepCookie = `hy-keep=${encodeURIComponent(step.value)}`;
      continue;
    }
    const label = `${step.action} ${step.method} ${step.path}`;
    console.log(`▶ ${label}`);
    const started = performance.now();
    const elapsed = () => `${Math.round(performance.now() - started)} ms`;
    let result;
    try {
      result = await runStep(step, label, send);
    } catch (error) {
      fail(`${label}: ${error.message} (${elapsed()})`);
      break;
    }
    console.log(`${failures === 0 ? 'ok' : 'checked'} ${label}: ${result} (${elapsed()})`);
  }
  if (node !== null && compared === 0) fail('the Node server answered no compared request; expected at least 1, actual 0');
  if (node !== null) console.log(`${failures === 0 ? 'ok' : 'checked'} Node server: ${compared} responses equal the PHP responses`);
  if (python !== null && compared === 0) fail('the Python server answered no compared request; expected at least 1, actual 0');
  if (python !== null) console.log(`${failures === 0 ? 'ok' : 'checked'} Python server: ${compared} responses equal the PHP responses`);
} catch (error) {
  fail(error.message);
} finally {
  await run.close();
}
if (failures > 0) {
  console.error(`${failures} parity failure(s)`);
  process.exit(1);
}

// Runs a send, status or compare step and returns the text of its result line.
async function runStep(step, label, send) {
  if (step.action === 'send') return String((await send(step, {})).status);
  if (step.action === 'status') {
    const html = await send(step, {});
    const json = await send(step, { Accept: 'application/json' });
    const routed = application.router.match(new URL(step.path, php.base).pathname);
    if (html.status !== step.status || json.status !== step.status) fail(`${label}: statuses ${html.status} and ${json.status}, expected ${step.status}`);
    return `${html.status}, browser route ${routed?.name ?? 'none'}`;
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
  // The server embeds the data of a document when the reply of its request asks for it (HY-92); the browser renders
  // the document with the same choice and must give the same bytes, the embedded data included.
  const embed = html.text.includes('<script type="application/json" id="hy-data">');
  const rendered = placeholder(browser.renderDocument(application, browser.decodeResponse(application, browser.parseJson(documentJson.text), path), { embed }), documentJson.token);
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
  return `${html.status}, route ${parts.route.name}, document ${Buffer.byteLength(rendered)} bytes, regions ${[...parts.regions.keys()].join(', ')}`;
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
    let response;
    let text;
    try {
      response = await fetch(base + step.path, {
        method: step.method,
        headers: { ...headers, ...type, ...(cookies ? { Cookie: cookies } : {}) },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') throw new Error(`${step.method} ${step.path} to ${base} got no response within ${REQUEST_TIMEOUT_MS} ms`);
      throw error;
    }
    const session = response.headers.getSetCookie().find((item) => item.startsWith(`${SESSION_COOKIE}=`));
    if (session !== undefined) state.cookie = session.split(';')[0];
    state.token = /name="_csrf" value="([^"]+)"/.exec(text)?.[1] ?? /"csrf":"([^"]+)"/.exec(text)?.[1] ?? state.token;
    return { status: response.status, headers: response.headers, text, token: state.token };
  };
  return state;
}

// Compares a PHP response and a Node response after the placeholders of HY-55 replace the values that differ by
// session.
function compare(label, expected, actual, server) {
  compared++;
  const a = normalize(label, 'PHP', expected);
  const b = normalize(label, server, actual);
  if (expected.status !== actual.status) fail(`${label}: ${server} status ${actual.status}, PHP status ${expected.status}`);
  if (a.headers.join('\n') !== b.headers.join('\n')) fail(`${label}: headers differ\n--- PHP\n${a.headers.join('\n')}\n--- ${server}\n${b.headers.join('\n')}`);
  if (a.text !== b.text) fail(`${label}: bodies differ\n--- PHP\n${a.text}\n--- ${server}\n${b.text}`);
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
