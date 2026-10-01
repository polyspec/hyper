// Serves an application over node:http with sessions in files.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { App } from './app.js';
import type { FileSessions } from './file-sessions.js';
import { Request } from './request.js';
import { Response } from './response.js';

export interface ServerOptions {
  // The largest request body in bytes; a larger body receives 413. The default is 8 MiB, PHP's post_max_size.
  bodyLimit?: number;
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
  const limit = options.bodyLimit ?? 8 * 1024 * 1024;
  const files = options.files;
  if (files !== undefined && (!isAbsolute(files) || !statSync(files).isDirectory())) throw new Error(`hyper: ${files} is not an absolute directory`);
  const server = createHttpServer((incoming, outgoing) => {
    serve(app, sessions, limit, files, incoming, outgoing).catch((error: unknown) => {
      app.fail(error);
      if (!outgoing.headersSent) write(outgoing, app.frame(Response.text(500, 'Internal Server Error')));
      else outgoing.destroy();
    });
  });
  server.on('clientError', (error: NodeJS.ErrnoException, socket: Socket) => {
    if (!socket.writable || error.code === 'ECONNRESET') {
      socket.destroy();
      return;
    }
    const [status, reason] = error.code === 'HPE_HEADER_OVERFLOW' ? [431, 'Request Header Fields Too Large'] : [400, 'Bad Request'];
    const response = app.frame(Response.text(status, reason));
    const headers = Object.entries(response.headers).map(([name, value]) => `${name}: ${String(value)}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${reason}\r\n${headers}Content-Length: ${Buffer.byteLength(reason)}\r\nConnection: close\r\n\r\n${reason}`);
  });
  return server;
}

async function serve<S extends object>(app: App<S>, sessions: FileSessions, limit: number, files: string | undefined, incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const file = files === undefined ? null : publicFile(files, incoming);
  if (file === null) {
    write(outgoing, await answer(app, sessions, limit, incoming));
    return;
  }
  outgoing.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': String(statSync(file).size) });
  if (incoming.method === 'HEAD') outgoing.end();
  else createReadStream(file).pipe(outgoing);
}

async function answer<S extends object>(app: App<S>, sessions: FileSessions, limit: number, incoming: IncomingMessage): Promise<Response> {
  const body = await readBody(incoming, limit);
  if (body === null) return app.frame(Response.text(413, 'Content Too Large'));
  const https = (incoming.socket as TLSSocket).encrypted === true;
  const request = Request.from({ method: incoming.method ?? 'GET', target: incoming.url ?? '/', headers: incoming.headers, body, https });
  const session = await sessions.open(request.cookie(sessions.name));
  let response: Response;
  try {
    response = await app.handle(request, session);
  } finally {
    session.close();
  }
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

// Reads the request body, or returns null when it is larger than the limit; the rest of a larger body is read and
// discarded, so that the response can be sent.
function readBody(incoming: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const discard = (): void => {
      incoming.removeListener('data', collect);
      incoming.resume();
      resolve(null);
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
    incoming.on('end', () => resolve(Buffer.concat(chunks)));
    incoming.on('error', reject);
  });
}

function write(outgoing: ServerResponse, response: Response): void {
  const empty = response.status === 204 || response.status === 304;
  outgoing.writeHead(response.status, empty ? response.headers : { ...response.headers, 'Content-Length': String(Buffer.byteLength(response.body)) });
  outgoing.end(empty ? undefined : response.body);
}
