// Serves an application over node:http with sessions in files.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { App } from './app.js';
import type { FileSessions } from './file-sessions.js';
import { Reply } from './reply.js';
import { Request } from './request.js';
import { Response } from './response.js';

export interface ServerOptions {
  // An absolute directory of public files. A GET or HEAD request whose path names a file in it receives the file,
  // as the PHP built-in server serves its document root; every other request goes to the application.
  files?: string;
}

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
  const files = options.files;
  if (files !== undefined && (!isAbsolute(files) || !statSync(files).isDirectory())) throw new Error(`hyper: ${files} is not an absolute directory`);
  const server = createHttpServer((incoming, outgoing) => {
    const started = performance.now();
    // The connection closed before the response was written (HY-67).
    const closed = new AbortController();
    outgoing.on('close', () => {
      if (!outgoing.writableEnded) closed.abort();
    });
    serve(app, sessions, files, incoming, outgoing, started, closed.signal).catch((error: unknown) => {
      app.fail(error);
      if (!outgoing.headersSent) write(outgoing, app.frame(Response.text(500, 'Internal Server Error')));
      else outgoing.destroy();
    });
  });
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

// Returns a request of the method and the target of the request line that node:http could not parse, or null
// when the packet has no request line.
function requestLine(packet: Buffer | undefined): Request | null {
  const line = /^([!-~]+) ([^ \r\n]+) HTTP\/[0-9.]+\r?\n/.exec(packet?.toString('latin1') ?? '');
  return line === null ? null : Request.from({ method: line[1]!, target: line[2]! });
}

async function serve<S extends object>(app: App<S>, sessions: FileSessions, files: string | undefined, incoming: IncomingMessage, outgoing: ServerResponse, started: number, signal: AbortSignal): Promise<void> {
  const file = files === undefined ? null : publicFile(files, incoming);
  if (file === null) {
    const response = await answer(app, sessions, incoming, started, signal);
    // A request whose client closed the connection has no response to write (HY-67).
    if (response !== null) write(outgoing, response);
    return;
  }
  outgoing.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': String(statSync(file).size) });
  if (incoming.method === 'HEAD') outgoing.end();
  else createReadStream(file).pipe(outgoing);
}

async function answer<S extends object>(app: App<S>, sessions: FileSessions, incoming: IncomingMessage, started: number, signal: AbortSignal): Promise<Response | null> {
  // The application answers a body larger than its limit with 413 (HY-59); the server reads no more of it.
  const { body, size } = await readBody(incoming, app.bodyLimit);
  const https = (incoming.socket as TLSSocket).encrypted === true;
  const request = Request.from({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, body, bodySize: size, https });
  let session;
  try {
    session = await sessions.open(request.cookie(sessions.name));
  } catch (error) {
    return app.report(request, app.frame(Response.text(500, 'Internal Server Error')), started, new Reply(), app.fail(error));
  }
  let response: Response | null;
  try {
    response = await app.handle(request, session, started, signal);
  } finally {
    session.close();
  }
  if (response === null) return null;
  const created = session.created;
  if (created === null) return response;
  // A new session sets its cookie first, as PHP does when the session starts (HY-45).
  const cookie = sessions.cookie(created, app.https || https);
  const cookies = response.headers['Set-Cookie'];
  return new Response(response.status, { ...response.headers, 'Set-Cookie': [cookie, ...(Array.isArray(cookies) ? cookies : [])] }, response.body);
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
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
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
