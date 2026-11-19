// Serves an application over node:http with sessions in files.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import { TLSSocket } from 'node:tls';
import type { App } from '../app/app.js';
import { ArgumentCountError } from '../app/argument-count-error.js';
import { binding, rules, type CoreRequestBody } from '../app/core-rules.js';
import { Cookies } from '../http/cookies.js';
import type { FileSession } from '../session/file-session.js';
import type { FileSessions } from '../session/file-sessions.js';
import type { RedisSessions } from '../session/redis-sessions.js';
import { RecordSession } from '../session/record-session.js';
import { Reply } from '../http/reply.js';
import { Disconnected } from '../app/disconnected.js';
import { Request } from '../http/request.js';
import type { BodyReader } from '../form/body-reader.js';
import { Response } from '../http/response.js';

export interface ServerOptions {
  // An absolute directory of public files. A GET or HEAD request whose path names a file in it receives the file,
  // as the PHP built-in server serves its document root; every other request goes to the application.
  files?: string;
  // The write hook (HY-99): called once for every request that the application answers, with the request, the response
  // whose write started or the plain 500 of an escaped error, whether the write ended, the elapsed milliseconds and the
  // failure of an escaped error.
  written?: WriteHook;
  // The request hook (HY-97): called once for every request that the application answers, with the request as the server
  // built it and the function `answer`, which runs the application for a request; the server writes the response that
  // the hook returns.
  around?: AroundHook;
}

// The request hook of a server (HY-97).
export type AroundHook = (request: Request, answer: (request: Request) => Promise<Response>) => Response | Promise<Response>;

// The write hook of a server (HY-99).
export type WriteHook = (request: Request, response: Response | null, ended: boolean, elapsed: number, failure: string | null) => void;

// The request listener of node:http that an application runs for every request (HY-100).
export type Listener = (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

// The names of the options of a host entry, the members of its options record (HY-106.9).
const SERVER_REQUIRED: string[] = [];
const SERVER_OPTIONAL = ['files', 'written', 'around'];

// Returns an HTTP server that answers every request with the application `app` and its sessions. The host entries
// are functions of the host code that take the application first, and no members of `App` (HY-100.28, HY-106.20).
export function server<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Server {
  ArgumentCountError.between(arguments.length, 2, 3);
  ArgumentCountError.members(options, SERVER_REQUIRED, SERVER_OPTIONAL);
  return createServer(app, sessions, options);
}

// Returns the node:http request listener that `server` installs (HY-100.28).
export function listener<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Listener {
  ArgumentCountError.between(arguments.length, 2, 3);
  ArgumentCountError.members(options, SERVER_REQUIRED, SERVER_OPTIONAL);
  return createListener(app, sessions, options);
}

// Returns a server that answers every request with the application. A request whose start line or headers
// node:http cannot parse, such as a request target with a byte outside ASCII (HY-42), receives a plain 400.
function createServer<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Server {
  const server = createHttpServer(createListener(app, sessions, options));
  server.on('clientError', (error: NodeJS.ErrnoException & { rawPacket?: Buffer }, socket: Socket) => {
    const started = performance.now();
    if (!socket.writable || error.code === 'ECONNRESET') {
      socket.destroy();
      return;
    }
    const [status, reason] = error.code === 'HPE_HEADER_OVERFLOW' ? [431, 'Request Header Fields Too Large'] : [400, 'Bad Request'];
    const response = app.frame(Response.text(status, reason));
    app.report(requestLine(error.rawPacket), response, started, new Reply());
    const headers = Object.entries(response.headers).map(([name, value]) => `${name}: ${String(value)}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${reason}\r\n${headers}Content-Length: ${Buffer.byteLength(reason)}\r\nConnection: close\r\n\r\n${reason}`);
  });
  return server;
}

// Returns the request listener that answers every request of node:http with the application and sessions in files
// (HY-100). It settles after the write hook and the disconnect hook of the request have run (HY-99, HY-67).
function createListener<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Listener {
  const files = options.files;
  if (files !== undefined && (!isAbsolute(files) || !statSync(files).isDirectory())) throw new Error(`hyper: ${files} is not an absolute directory`);
  const written = options.written;
  if (written !== undefined && typeof written !== 'function') throw rules().valueError('the write hook is not callable (HY-99)', 'invalid_application');
  const around = options.around;
  if (around !== undefined && typeof around !== 'function') throw rules().valueError('the request hook is not callable (HY-97)', 'invalid_application');
  return async (incoming, outgoing) => {
    const started = performance.now();
    // The connection closed before the response was written (HY-67).
    const closed = new AbortController();
    outgoing.on('close', () => {
      if (!outgoing.writableEnded) closed.abort();
    });
    const finished = new Promise<void>((resolve) => outgoing.once('close', () => resolve()));
    const https = incoming.socket instanceof TLSSocket && incoming.socket.encrypted;
    // The request as the server received it, with an empty body until the body is read (HY-60), and the response of
    // the request: the response whose write started, the plain 500 of an escaped error, or null when the request ended
    // before a response started (HY-99).
    let request: Request | null = null;
    let reply: Reply | null = null;
    let response: Response | null = null;
    let failure: string | null = null;
    let stopped = false;
    // The request of the last call of `answer`, which the disconnect hook receives (HY-97).
    let disconnectedRequest: Request | null = null;
    // The body as it is read, whose directory holds the files of a body read in chunks (HY-131).
    let read: BodyReader | null = null;
    // The request that holds `read`, which releases the files of the body (HY-131.14).
    let holder: Request | null = null;
    try {
      // HY-100.2: a request whose target node:http does not give is answered with the plain 500 and not as the request
      // of the path `/`, which would be the answer to another request; no request exists then, so no write hook is
      // called (HY-99.12).
      const target = incoming.url;
      if (target === undefined) throw new Error('hyper: the request has no target (HY-100)');
      // HY-42.9: every line of a name, which `headers` of node:http keeps only the first of for the names that it reads
      // as one value; `requestOf` joins them (HY-42.15). The request as received exists before the public directory is
      // read, so that a failed stat of its file is an escaped error that the write hook receives with it (HY-60.14,
      // HY-60.17); a file that is served returns before the hooks (HY-100.7).
      request = requestOf({ method: incoming.method ?? 'GET', target, headers: incoming.headersDistinct, rawHeaders: incoming.rawHeaders, https });
      const file = files === undefined ? null : publicFile(files, incoming, target);
      if (file !== null) {
        serveFile(outgoing, incoming, file);
        return;
      }
      // The application answers a body larger than its limit with 413 (HY-59); the server reads no more of it.
      // HY-131: a multipart body of an application with that form type is read in chunks into files of the request.
      // The core reads the chunks under the four limits in their order (F-25, HY-131.32).
      // HY-131.29: the core fails a Content-Length that is no number with invalid_content_length and a number above the
      // body limit with body_limit before any byte is read; that failure is the failure of the body, which reads no chunk.
      const contentType = request.header('Content-Type') ?? null;
      const stream = app.formTypes.includes('multipart/form-data');
      const limits = { limit: app.bodyLimit, valueLimit: app.valueLimit, partLimit: app.partLimit, fileLimit: app.fileLimit };
      let body: CoreRequestBody;
      let refused: string | null = null;
      try {
        body = await binding().RequestBody.start(contentType, request.header('Content-Length') ?? null, stream, limits);
      } catch (error) {
        refused = error instanceof Error && 'kind' in error && typeof error.kind === 'string' ? error.kind : null;
        if (refused === null) throw error;
        body = await binding().RequestBody.start(contentType, null, stream, limits);
        // HY-131.31: no byte of a refused body is parsed or stored; the host reads the rest of it to discard it, as it
        // does for a declared length above the limit, so that the response is sent and the connection can be reused.
        incoming.resume();
      }
      read = { core: body, failure: refused };
      const failure = refused ?? await readBody(incoming, body, app.bodyLimit);
      read = { core: body, failure };
      request = requestOf({ method: incoming.method ?? 'GET', target, headers: incoming.headersDistinct, rawHeaders: incoming.rawHeaders, body: body.held(), bodySize: failure === 'body_limit' ? Math.max(body.size(), app.bodyLimit + 1) : body.size(), https }, read);
      holder = request;
      // The last call of `answer`: its request and its reply, which the disconnect hook receives (HY-67, HY-97).
      const last: { request?: Request; reply?: Reply } = {};
      // Answers with the application, which opens the session of the request by its session cookie only for a route that
      // uses it (HY-104.38), closes an opened session and adds the cookie of a new session first (HY-45).
      const answerWith = async (given: Request): Promise<Response> => {
        const opened: { session: FileSession | null } = { session: null };
        const open = async (): Promise<FileSession> => {
          opened.session = await sessions.open(given.cookie(RecordSession.cookieName(app.https || https)));
          return opened.session;
        };
        let answer;
        try {
          answer = await app.respond(given.withSignal(closed.signal), open, started);
        } finally {
          await opened.session?.close();
        }
        last.request = given;
        last.reply = answer.reply;
        // A request whose client closed the connection has no response to write (HY-67).
        if (answer.stopped) throw new Disconnected();
        return withSessionCookie(app, sessions, answer.response, opened.session?.created() ?? null, https);
      };
      try {
        const given = around === undefined ? await answerWith(request) : await around(request, answerWith);
        if (!(given instanceof Response)) throw new TypeError(`hyper: the request hook returned ${typeof given}, not a Response`);
        response = given;
        write(outgoing, response);
      } catch (error) {
        // The write hook receives null for a stopped request (HY-99).
        if (!(error instanceof Disconnected) || last.reply === undefined) throw error;
        stopped = true;
      }
      reply = last.reply ?? null;
      disconnectedRequest = last.request ?? null;
    } catch (error) {
      // An error that escapes the answer of a request is logged with the message of HY-43 and answered with a plain 500
      // that hyper writes; when the response has started or the 500 cannot be written, the connection closes (HY-60).
      failure = app.logFailure(error);
      if (outgoing.headersSent || outgoing.destroyed) {
        outgoing.destroy();
        response ??= app.frame(Response.text(500, 'Internal Server Error'));
      } else {
        response = app.frame(Response.text(500, 'Internal Server Error'));
        try {
          write(outgoing, response);
        } catch (writeError) {
          app.logFailure(writeError);
          outgoing.destroy();
        }
      }
    }
    if (request === null) return;
    // HY-99: the write hook runs after the close of the response; the disconnect hook (HY-67) follows it, also when the
    // write hook raises, which then reaches the transport.
    await finished;
    try {
      written?.(request, response, outgoing.writableFinished, performance.now() - started, failure);
    } finally {
      try {
        if (stopped && reply !== null) app.disconnected(disconnectedRequest ?? request, started, reply);
      } finally {
        // HY-131.14: the files of the request are removed after its hooks returned; a body that failed while it was read
        // has no request that holds it.
        if (holder === null) await read?.core.remove();
        else await holder.release();
      }
    }
  };
}

// Returns a request of the method and the target of the request line that node:http could not parse, or null
// when the packet has no request line.
function requestLine(packet: Buffer | undefined): Request | null {
  const line = /^([!-~]+) ([^ \r\n]+) HTTP\/[0-9.]+\r?\n/.exec(packet?.toString('latin1') ?? '');
  const [, method, target] = line ?? [];
  return method === undefined || target === undefined ? null : requestOf({ method, target });
}

// Adds the cookie of a new session first, as PHP does when the session starts (HY-45).
function withSessionCookie<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, response: Response, created: string | null, https: boolean): Response {
  return response.withSessionCookie(created === null ? null : RecordSession.cookieHeader(created, app.https || https));
}

// Returns the request of the parts that node:http gives (HY-100): the method in upper case, the path and the raw query
// of the request target, each header as one value, the lines of a name joined with `, ` and the Cookie lines with `; `
// (HY-42.15), and the cookies of the one parse of the Cookie lines of `rawHeaders`, which the host passes apart and in
// order (HY-129.14). `read` is the body as the host read it.
/** @internal */
export function requestOf(
  parts: { method: string; target: string; headers?: Record<string, string | string[] | undefined>; rawHeaders?: readonly string[]; body?: Uint8Array; bodySize?: number; https?: boolean },
  read: BodyReader | null = null,
): Request {
  const headers: Record<string, string> = {};
  const lines: string[] = [];
  for (const [name, value] of Object.entries(parts.headers ?? {})) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    headers[key] = Array.isArray(value) ? value.join(key === 'cookie' ? '; ' : ', ') : value;
  }
  // rawHeaders holds each field line as a name followed by its value.
  const raw = parts.rawHeaders ?? [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === 'cookie') lines.push(raw[index + 1] ?? '');
  }
  return new Request({
    method: parts.method.toUpperCase(),
    path: Request.targetPath(parts.target),
    headers,
    query: Request.targetQuery(parts.target),
    ...(parts.body === undefined ? {} : { body: parts.body }),
    cookies: Cookies.parse(lines),
    https: parts.https ?? false,
    ...(parts.bodySize === undefined ? {} : { bodySize: parts.bodySize }),
    read,
  });
}

// Serves a file of the public directory (HY-62): no application runs and no hook is called.
function serveFile(outgoing: ServerResponse, incoming: IncomingMessage, file: string): void {
  outgoing.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': String(statSync(file).size) });
  if (incoming.method === 'HEAD') outgoing.end();
  else createReadStream(file).pipe(outgoing);
}

// Returns the file of a GET or HEAD request path in the public directory, or null; `target` is the target of the request.
function publicFile(files: string, incoming: IncomingMessage, target: string): string | null {
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') return null;
  const path = Request.targetPath(target);
  if (!/^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/.test(path)) return null;
  const file = join(files, path);
  try {
    return statSync(file).isFile() ? file : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

// Gives the request body to the body of the core in chunks, each after the core took the last one (HY-131.33), and
// resolves with the kind of http-form of the first failure of the body, or null when it read to its end. After a
// failure the rest of the body is read and discarded, so that the response can be sent (HY-59); a declared length
// above the limit reads none of it.
function readBody(incoming: IncomingMessage, body: CoreRequestBody, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // The failure of the core: its kind for a failure of the body, or a rejection for any other error.
    const failed = (error: unknown): void => {
      incoming.removeListener('data', collect);
      incoming.resume();
      const kind = error instanceof Error && 'kind' in error && typeof error.kind === 'string' ? error.kind : null;
      if (kind === null || kind === 'internal' || (error instanceof Error && 'category' in error && error.category === 'io')) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(kind);
    };
    let pending: Promise<void> = Promise.resolve();
    const collect = (chunk: Buffer): void => {
      incoming.pause();
      pending = pending.then(() => body.feed(chunk)).then(() => {
        incoming.resume();
      }, failed);
    };
    if (Number(incoming.headers['content-length'] ?? 0) > limit) {
      incoming.resume();
      resolve('body_limit');
      return;
    }
    incoming.on('data', collect);
    incoming.on('end', () => {
      pending.then(() => body.finish()).then(() => {
        resolve(null);
      }, failed);
    });
    incoming.on('error', reject);
  });
}

function write(outgoing: ServerResponse, response: Response): void {
  const empty = response.status === 204 || response.status === 304;
  outgoing.writeHead(response.status, empty ? response.headers : { ...response.headers, 'Content-Length': String(Buffer.byteLength(response.body)) });
  outgoing.end(empty ? undefined : response.body);
}
