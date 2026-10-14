// Serves an application over node:http with sessions in files.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import { TLSSocket } from 'node:tls';
import type { App } from './app.js';
import { errorCode } from './error-code.js';
import { FileSessions } from './file-sessions.js';
import { Reply } from './reply.js';
import { Request } from './request.js';
import { Response } from './response.js';

export interface ServerOptions {
  // An absolute directory of public files. A GET or HEAD request whose path names a file in it receives the file,
  // as the PHP built-in server serves its document root; every other request goes to the application.
  files?: string;
  // The write hook (HY-99): called once for every request that the application answers, with the request, the response
  // whose write started or the plain 500 of an escaped error, whether the write ended, the elapsed milliseconds and the
  // failure of an escaped error.
  written?: WriteHook;
}

// The write hook of a server (HY-99).
export type WriteHook = (request: Request, response: Response | null, ended: boolean, elapsed: number, failure: string | null) => void;

// The request listener of node:http that an application runs for every request (HY-102).
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
export function createServer<S extends object>(app: App<S>, sessions: FileSessions, options: ServerOptions = {}): Server {
  const server = createHttpServer(createListener(app, sessions, options));
  server.on('clientError', (error: NodeJS.ErrnoException & { rawPacket?: Buffer }, socket: Socket) => {
    const started = performance.now();
    if (!socket.writable || error.code === 'ECONNRESET') {
      socket.destroy();
      return;
    }
    const [status, reason] = error.code === 'HPE_HEADER_OVERFLOW' ? [431, 'Request Header Fields Too Large'] : [400, 'Bad Request'];
    const response = app.report(requestLine(error.rawPacket), app.frame(Response.text(status, reason)), started, new Reply());
    const headers = Object.entries(response.headers).map(([name, value]) => `${name}: ${String(value)}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${reason}\r\n${headers}Content-Length: ${Buffer.byteLength(reason)}\r\nConnection: close\r\n\r\n${reason}`);
  });
  return server;
}

// Returns the request listener that answers every request of node:http with the application and sessions in files
// (HY-102). It settles after the write hook and the disconnect hook of the request have run (HY-99, HY-67).
export function createListener<S extends object>(app: App<S>, sessions: FileSessions, options: ServerOptions = {}): Listener {
  const files = options.files;
  if (files !== undefined && (!isAbsolute(files) || !statSync(files).isDirectory())) throw new Error(`hyper: ${files} is not an absolute directory`);
  const written = options.written;
  if (written !== undefined && typeof written !== 'function') throw new Error('hyper: the write hook must be a function');
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
    try {
      const file = files === undefined ? null : publicFile(files, incoming);
      if (file !== null) {
        serveFile(outgoing, incoming, file);
        return;
      }
      request = Request.from({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, https });
      // The application answers a body larger than its limit with 413 (HY-59); the server reads no more of it.
      const { body, size } = await readBody(incoming, app.bodyLimit);
      request = Request.from({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, body, bodySize: size, https });
      const session = await sessions.open(request.cookie(FileSessions.cookieName(app.https || https)));
      let answer;
      try {
        answer = await app.respond(request, session, started, closed.signal);
      } finally {
        session.close();
      }
      reply = answer.reply;
      if (answer.stopped) {
        // A request whose client closed the connection has no response to write (HY-67); the write hook receives null (HY-99).
        stopped = true;
      } else {
        response = withSessionCookie(app, sessions, answer.response, session.created, https);
        write(outgoing, response);
      }
    } catch (error) {
      // An error that escapes the answer of a request is logged with the message of HY-43 and answered with a plain 500
      // that hyper writes; when the response has started or the 500 cannot be written, the connection closes (HY-60).
      failure = app.fail(error);
      if (outgoing.headersSent || outgoing.destroyed) {
        outgoing.destroy();
        response ??= app.frame(Response.text(500, 'Internal Server Error'));
      } else {
        response = app.frame(Response.text(500, 'Internal Server Error'));
        try {
          write(outgoing, response);
        } catch (writeError) {
          app.fail(writeError);
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
      if (stopped && reply !== null) app.disconnected(request, started, reply);
    }
  };
}

// Returns a request of the method and the target of the request line that node:http could not parse, or null
// when the packet has no request line.
function requestLine(packet: Buffer | undefined): Request | null {
  const line = /^([!-~]+) ([^ \r\n]+) HTTP\/[0-9.]+\r?\n/.exec(packet?.toString('latin1') ?? '');
  const [, method, target] = line ?? [];
  return method === undefined || target === undefined ? null : Request.from({ method, target });
}

// Adds the cookie of a new session first, as PHP does when the session starts (HY-45).
function withSessionCookie<S extends object>(app: App<S>, sessions: FileSessions, response: Response, created: string | null, https: boolean): Response {
  if (created === null) return response;
  const cookie = sessions.cookie(created, app.https || https);
  const cookies = response.headers['Set-Cookie'];
  return new Response(response.status, { ...response.headers, 'Set-Cookie': [cookie, ...(Array.isArray(cookies) ? cookies : [])] }, response.body);
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
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) return null;
    throw error;
  }
}

// Reads the request body and its size. A body larger than the limit gives no bytes and the size read so far, or the
// Content-Length; the rest of it is read and discarded, so that the response can be sent.
function readBody(incoming: IncomingMessage, limit: number): Promise<{ body: Uint8Array; size: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const discard = (): void => {
      incoming.removeListener('data', collect);
      incoming.resume();
      resolve({ body: new Uint8Array(), size });
    };
    const collect = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) discard();
      else chunks.push(chunk);
    };
    if (Number(incoming.headers['content-length'] ?? 0) > limit) {
      discard();
      return;
    }
    incoming.on('data', collect);
    incoming.on('end', () => resolve({ body: Buffer.concat(chunks), size }));
    incoming.on('error', reject);
  });
}

function write(outgoing: ServerResponse, response: Response): void {
  const empty = response.status === 204 || response.status === 304;
  outgoing.writeHead(response.status, empty ? response.headers : { ...response.headers, 'Content-Length': String(Buffer.byteLength(response.body)) });
  outgoing.end(empty ? undefined : response.body);
}
