// Serves an application over node:http with sessions in files.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import { TLSSocket } from 'node:tls';
import type { App } from '../app/app.js';
import { Cookies } from '../http/cookies.js';
import type { FileSessions } from '../session/file-sessions.js';
import type { RedisSessions } from '../session/redis-sessions.js';
import { RecordSession } from '../session/record-session.js';
import { Reply } from '../http/reply.js';
import { Disconnected } from '../app/disconnected.js';
import { Request } from '../http/request.js';
import { RequestBody } from '../form/request-body.js';
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

// Returns a server that answers every request with the application. A request whose start line or headers
// node:http cannot parse, such as a request target with a byte outside ASCII (HY-42), receives a plain 400.
/** @internal */
export function createServer<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Server {
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
/** @internal */
export function createListener<S extends object>(app: App<S>, sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Listener {
  const files = options.files;
  if (files !== undefined && (!isAbsolute(files) || !statSync(files).isDirectory())) throw new Error(`hyper: ${files} is not an absolute directory`);
  const written = options.written;
  if (written !== undefined && typeof written !== 'function') throw new Error('hyper: the write hook is not callable (HY-99)');
  const around = options.around;
  if (around !== undefined && typeof around !== 'function') throw new Error('hyper: the request hook is not callable (HY-97)');
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
    let read: RequestBody | null = null;
    // The request that holds `read`, which releases the files of the body (HY-131.14).
    let holder: Request | null = null;
    try {
      const file = files === undefined ? null : publicFile(files, incoming);
      if (file !== null) {
        serveFile(outgoing, incoming, file);
        return;
      }
      request = requestOf({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, https });
      // The application answers a body larger than its limit with 413 (HY-59); the server reads no more of it.
      // HY-131: a multipart body of an application with that form type is read in chunks into files of the request.
      read = new RequestBody(incoming.headers['content-type'] ?? '', app.bodyLimit, app.formTypes.includes('multipart/form-data'), app.valueLimit, app.partLimit, app.fileLimit);
      await readBody(incoming, read, app.bodyLimit);
      request = requestOf({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, body: read.held(), bodySize: read.size(), https }, read);
      holder = request;
      // The last call of `answer`: its request and its reply, which the disconnect hook receives (HY-67, HY-97).
      const last: { request?: Request; reply?: Reply } = {};
      // Opens the session of the request by its session cookie, answers with the application, closes the session and
      // adds the cookie of a new session first (HY-45).
      const answerWith = async (given: Request): Promise<Response> => {
        const session = await sessions.open(given.cookie(RecordSession.cookieName(app.https || https)));
        let answer;
        try {
          answer = await app.respond(given.withSignal(closed.signal), session, started);
        } finally {
          await session.close();
        }
        last.request = given;
        last.reply = answer.reply;
        // A request whose client closed the connection has no response to write (HY-67).
        if (answer.stopped) throw new Disconnected();
        return withSessionCookie(app, sessions, answer.response, session.created(), https);
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
        if (holder === null) await read?.remove();
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
  if (created === null) return response;
  const cookie = RecordSession.cookieHeader(created, app.https || https);
  const cookies = response.headers['Set-Cookie'];
  return new Response(response.status, { ...response.headers, 'Set-Cookie': [cookie, ...(Array.isArray(cookies) ? cookies : [])] }, response.body);
}

// Returns the request of the parts that node:http gives (HY-100): the method in upper case, the path and the raw query
// of the request target, each header as one value, and the cookies of the one parse of the Cookie header (HY-129).
// Several Cookie lines are one header joined with `; `, and other repeated headers join with `, `. `read` is the body
// as the host read it.
/** @internal */
export function requestOf(
  parts: { method: string; target: string; headers?: Record<string, string | string[] | undefined>; body?: Uint8Array; bodySize?: number; https?: boolean },
  read: RequestBody | null = null,
): Request {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parts.headers ?? {})) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    headers[key] = Array.isArray(value) ? value.join(key === 'cookie' ? '; ' : ', ') : value;
  }
  return new Request({
    method: parts.method.toUpperCase(),
    path: Request.targetPath(parts.target),
    headers,
    query: Request.targetQuery(parts.target),
    ...(parts.body === undefined ? {} : { body: parts.body }),
    cookies: Cookies.parse(headers.cookie ?? null),
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

// Returns the file of a GET or HEAD request path in the public directory, or null.
function publicFile(files: string, incoming: IncomingMessage): string | null {
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') return null;
  const path = Request.targetPath(incoming.url ?? '/');
  if (!/^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/.test(path)) return null;
  const file = join(files, path);
  try {
    return statSync(file).isFile() ? file : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

// Gives the request body to `read` in chunks. A body larger than the limit is not kept: the rest of it is read and
// discarded, so that the response can be sent (HY-59). The next chunk is read after the files of the body took the
// bytes of the last one (HY-131.21).
function readBody(incoming: IncomingMessage, read: RequestBody, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = (): void => {
      incoming.removeListener('data', collect);
      incoming.resume();
    };
    const collect = (chunk: Buffer): void => {
      if (!read.feed(chunk)) {
        stop();
        resolve();
        return;
      }
      incoming.pause();
      read.written().then(
        () => incoming.resume(),
        (error: unknown) => {
          stop();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    };
    if (Number(incoming.headers['content-length'] ?? 0) > limit) {
      incoming.resume();
      resolve();
      return;
    }
    incoming.on('data', collect);
    incoming.on('end', () => {
      read.written().then(resolve, reject);
    });
    incoming.on('error', reject);
  });
}

function write(outgoing: ServerResponse, response: Response): void {
  const empty = response.status === 204 || response.status === 304;
  outgoing.writeHead(response.status, empty ? response.headers : { ...response.headers, 'Content-Length': String(Buffer.byteLength(response.body)) });
  outgoing.end(empty ? undefined : response.body);
}
