// The Node server of tests/scripts/upload-servers.test.mts: the server of `App.server`, with the application that the
// test built in UPLOAD_APP. The request hook answers every request with what the request gave of its body as JSON:
// whether its input is valid, its form values, and the name, the filename, the content type, the size and the SHA-256
// digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of requests in
// the temporary directory while the request runs. It prints the address that it listens on.
//
// The variables of a start (the hooks are installed only when UPLOAD_LOG is set, so a start without it runs no hook):
//   UPLOAD_ANSWER  the request hook: unset (the JSON above), app, none (no request hook), mark, accept, alone,
//                  alone-gate, throws, not-a-response, cookies
//   UPLOAD_LOG     the file that receives one line for each call of the request hook, of the shared handler, of a
//                  loader, of the response hook, of the write hook and of the disconnect hook; with it the server
//                  prints `ended <client port>` when the listener of the application settled for a request
//   UPLOAD_ERRORS  the file that receives the log of the application
//   UPLOAD_HOOK    throws: the response hook throws after its line
//   UPLOAD_LOAD    throws: the loader of the route home throws after its line
//   UPLOAD_SESSIONS_OPEN  throws: the open of the session store throws
//   UPLOAD_BEFORE  1: the header X-Before is set before the application receives the request
//   UPLOAD_HTTPS   1: the application declares https
//   UPLOAD_FILES   the directory of public files
//   UPLOAD_GATE    the port of the gate of the test; UPLOAD_GATE_AT=shared stops the shared handler at it
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, readdirSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, FileSessions, Representation, Response, Result } from '@polyspec/hyper-server';

const application = process.env.UPLOAD_APP;
const moved = process.env.UPLOAD_MOVED;
const limit = Number(process.env.UPLOAD_LIMIT);
const log = process.env.UPLOAD_LOG;
const errors = process.env.UPLOAD_ERRORS;
const mode = process.env.UPLOAD_ANSWER ?? '';
const FILLER = 'x'.repeat(6 * 1024 * 1024);
// The request of node:http that runs: the promise of the close of its response.
const current = new AsyncLocalStorage();

// Appends one line to the hook log; without UPLOAD_LOG nothing is written.
const line = (text) => {
  if (log !== undefined) appendFileSync(log, `${text}\n`);
};
const elapsed = (value) => (Number.isFinite(value) && value >= 0 ? 'ok' : 'bad');
const notes = (reply) => JSON.stringify(Object.fromEntries(reply.notes()));
const mark = (request) => (request === null ? '- - mark=-' : `${request.method} ${request.path()} mark=${request.header('X-Mark') ?? '-'}`);
// The line of a handler, which reads the header by its name in lower case (HY-97.4).
const loaded = (name, request) => line(`load ${name} mark=${request.header('x-mark') ?? '-'}`);

// Stops at the gate of the test until the test opened it or closed the connection of the gate, and until node:http
// reported the close of the response of the request that runs, from which Node learns that the client left (HY-67.3).
async function pass(point) {
  const opened = new Promise((resolve, reject) => {
    const gate = connect(Number(process.env.UPLOAD_GATE), '127.0.0.1');
    let text = '';
    gate.on('connect', () => gate.write(`gate ${point}\n`));
    gate.on('data', (chunk) => {
      text += chunk.toString();
      if (text.includes('open\n')) gate.destroy();
    });
    gate.on('close', resolve);
    gate.on('error', reject);
  });
  await Promise.all([opened, current.getStore().closed]);
}

// The answer of the first form of this file: what the request gave of its body.
async function upload(request) {
  // UPLOAD_USAGE=1 is the form of benchmarks/uploads.mts: the sizes of the files without a move, and the processor
  // time and the largest memory of the process.
  const usage = process.env.UPLOAD_USAGE === '1';
  const files = [];
  for (const [name, list] of request.files()) {
    for (const file of list) {
      if (usage) {
        files.push([name, file.size()]);
        continue;
      }
      const target = join(moved, `node-${files.length}`);
      file.moveTo(target);
      const digest = createHash('sha256');
      for await (const block of createReadStream(target)) digest.update(block);
      files.push([name, file.filename(), file.contentType(), file.size(), digest.digest('hex')]);
      unlinkSync(target);
    }
  }
  const answer = { valid: request.validInput(), form: request.form(), files, held: readdirSync(tmpdir()).filter((name) => name.startsWith('hyper-')).length };
  if (usage) {
    const used = process.resourceUsage();
    answer.cpu = (used.userCPUTime + used.systemCPUTime) / 1000;
    // Node gives the largest memory in kilobytes; the answer holds bytes, as PHP and Python give them on Darwin.
    answer.rss = used.maxRSS * 1024;
  }
  return Response.text(200, JSON.stringify(answer));
}

// The request hook of UPLOAD_ANSWER.
async function around(request, answer) {
  line(`around ${request.method} ${request.path()} mark=${request.header('X-Mark') ?? '-'}`);
  switch (mode) {
    case 'app':
      return answer(request);
    case 'mark':
      return (await answer(request.withHeader('X-Mark', 'changed'))).withHeader('X-Around', 'yes');
    case 'accept':
      return answer(request.withHeader('Accept', 'application/vnd.hyper+json'));
    case 'alone':
      return Response.text(418, 'alone');
    case 'alone-gate':
      await pass('around');
      return Response.text(200, FILLER);
    case 'throws':
      throw new Error('around boom');
    case 'not-a-response':
      return 'not a response';
    case 'cookies':
      return Response.text(200, JSON.stringify({ a: request.cookie('a'), b: request.cookie('b') }));
    default:
      return upload(request);
  }
}

const app = await App.open({
  manifest: join(application, 'manifest.json'),
  build: join(application, 'build.json'),
  templates: { index: join(application, 'node/templates.index.json'), root: join(application, 'node') },
  handlers: {
    ...(log === undefined
      ? {}
      : {
          shared: async ({ request, reply }) => {
            loaded('shared', request);
            reply.note('stage', 'shared');
            if (process.env.UPLOAD_GATE_AT === 'shared') await pass('shared');
            return {};
          },
        }),
    routes: {
      home: {
        load: ({ request }) => {
          loaded('home', request);
          if (process.env.UPLOAD_LOAD === 'throws') throw new Error('handler boom');
          return {};
        },
      },
      // The representation of an item: a PUT answers the JSON value that it read, and a GET the item of the path.
      item: {
        load: ({ request }) => {
          loaded('item', request);
          return {};
        },
        representations: {
          'application/vnd.example.item+json': ({ request }) => new Representation(200, request.method === 'PUT' ? request.json() : { id: request.param('id'), title: 'é' }),
        },
      },
      large: {
        load: ({ request }) => {
          loaded('large', request);
          return { filler: FILLER };
        },
      },
      list: {
        regions: {
          rows: ({ request, reply }) => {
            if (request.queryInt('embed', 0) === 1) reply.embedData();
            return { items: ['a', 'b'], open: false };
          },
        },
      },
      add: { post: () => Result.redirect('/') },
    },
  },
  timezone: 'Z',
  https: process.env.UPLOAD_HTTPS === '1',
  bodyLimit: limit,
  responseLimit: 16 * 1024 * 1024,
  formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'],
  fileLimit: limit,
  partLimit: Number(process.env.UPLOAD_PARTS ?? 1000),
  ...(errors === undefined ? {} : { log: (message) => appendFileSync(errors, `${message}\n`) }),
  ...(log === undefined
    ? {}
    : {
        onResponse: (request, response, time, reply, failure) => {
          line(`response ${response.status} ${mark(request)} elapsed=${elapsed(time)} failure=${JSON.stringify(failure)} notes=${notes(reply)}`);
          if (process.env.UPLOAD_HOOK === 'throws') throw new Error('hook boom');
        },
        onDisconnect: (request, time, reply) => line(`disconnect ${mark(request)} elapsed=${elapsed(time)} notes=${notes(reply)}`),
      }),
});
// The session store of UPLOAD_SESSIONS_OPEN=throws, whose open fails before the application runs (HY-60.14).
class BrokenSessions extends FileSessions {
  async open() {
    throw new Error('the session directory is gone');
  }
}
const sessions = process.env.UPLOAD_SESSIONS_OPEN === 'throws' ? BrokenSessions : FileSessions;
const server = app.server(new sessions({ directory: process.env.UPLOAD_SESSIONS }), {
  ...(mode === 'none' ? {} : { around }),
  ...(log === undefined ? {} : { written: (request, response, ended, time, failure) => line(`written ${response === null ? 'null' : response.status} ${ended} ${mark(request)} elapsed=${elapsed(time)} failure=${JSON.stringify(failure)}`) }),
  ...(process.env.UPLOAD_FILES === undefined ? {} : { files: process.env.UPLOAD_FILES }),
});
if (log !== undefined) {
  // The listener of the application runs inside a listener of this file, as a consumer of the listener runs it
  // (HY-97.9): this one sets a header before the application, keeps the close of the response for the gate, and prints
  // the end of the request when the promise of the listener settled, after which every hook of the request has returned.
  const [listener] = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (incoming, outgoing) => {
    const port = incoming.socket.remotePort;
    if (process.env.UPLOAD_BEFORE === '1') outgoing.setHeader('X-Before', 'kept');
    const closed = new Promise((resolve) => outgoing.once('close', resolve));
    current.run({ closed }, () => listener(incoming, outgoing)).then(
      () => console.log(`ended ${port}`),
      (error) => {
        console.error(error);
        console.log(`ended ${port}`);
      },
    );
  });
}
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`the upload server listens on no TCP port: ${String(address)}`);
  console.log(`upload on http://127.0.0.1:${address.port}`);
});
