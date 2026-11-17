// Serves the board example with the Node server, as public/index.php serves it with PHP. `make node-server` builds
// this file into build/node/server.mjs.
//
// Environment: BOARD_DB (the SQLite database file), BOARD_SESSIONS (an absolute session directory), BOARD_PORT (0
// lets the system assign the port; the server prints the port that it listens on), and as for PHP BOARD_BASE_PATH, BOARD_HTTPS=1, BOARD_FRAME_ANCESTORS (HY-45) and BOARD_TIME.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, FileSessions, RedisSessions } from '@polyspec/hyper';
import { handlers, type Services } from './handlers.js';
import { Posts } from './posts.js';

// The bundle is build/node/server.mjs inside the board directory.
const board = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};
const database = env('BOARD_DB');
const port = Number(env('BOARD_PORT'));

// BOARD_SENTINEL, `host:port` of each Sentinel separated by commas, keeps the sessions on the primary hyper that they name,
// BOARD_CLUSTER, `host:port` of nodes of a Redis Cluster separated by commas, keeps them on that cluster, and
// BOARD_REDIS, the URL of a Redis server, keeps them there; otherwise they are files in BOARD_SESSIONS. The Redis store
// keeps its own connections, and a request whose command fails answers status 500 (HY-115). A lock expires after 30
// seconds, longer than any request of the board.
const sessionStore = async (): Promise<FileSessions | RedisSessions> => {
  const nodes = process.env.BOARD_CLUSTER;
  if (nodes !== undefined && nodes !== '') {
    return new RedisSessions({ setting: { kind: 'cluster', urls: nodes.split(',').map((item) => `redis://${item}`), user: null, password: null, authorities: null }, lockExpire: 30 });
  }
  const sentinels = process.env.BOARD_SENTINEL;
  if (sentinels !== undefined && sentinels !== '') {
    const urls = sentinels.split(',').map((item) => `redis://${item}`);
    return new RedisSessions({ setting: { kind: 'sentinel', urls, service: 'hyper', tls: false, user: null, password: null, authorities: null }, lockExpire: 30 });
  }
  const url = process.env.BOARD_REDIS;
  if (url === undefined || url === '') {
    const directory = env('BOARD_SESSIONS');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return FileSessions.inDirectory({ directory });
  }
  return new RedisSessions({ setting: { kind: 'server', url, authorities: null }, lockExpire: 30 });
};

const app = await App.open<Services>({
  manifest: join(board, 'app', 'app.json'),
  // `make board` writes the server program, with its read paths, its build id and its templates, into build/program,
  // which App.open reads (HY-48.19, HY-125).
  program: join(board, 'build', 'program'),
  handlers,
  timezone: '+09:00',
  // The form of a new post is multipart, because it holds a file (HY-59.1, HY-131).
  formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'],
  basePath: process.env.BOARD_BASE_PATH ?? '',
  https: process.env.BOARD_HTTPS === '1',
  frameAncestors: process.env.BOARD_FRAME_ANCESTORS || "'self'",
  // The context of every page (HY-124): the name of the site, which the title template reads.
  context: () => new Map([['site', new Map([['name', '게시판 예제']])]]),
});
// BOARD_TIME fixes the creation time of new posts in Unix seconds, so that two servers store the same posts
// (`make server-parity`); without it a post has the current time.
const time = process.env.BOARD_TIME ?? '';
if (time !== '' && !/^[0-9]{1,15}$/.test(time)) throw new Error('BOARD_TIME must be Unix seconds');
app.bind('posts', () => new Posts(database, time === '' ? () => Math.floor(Date.now() / 1000) : () => Number(time)));
app.bind('assets', () => {
  const urls: unknown = JSON.parse(readFileSync(join(board, 'build', 'client', 'manifest.json'), 'utf8'));
  if (typeof urls !== 'object' || urls === null || !('hyper' in urls) || typeof urls.hyper !== 'string') throw new Error('the asset manifest has no hyper URL; run make board');
  return { hyper: urls.hyper };
});
// The session cookie has the name that the PHP board uses, PHP's default session name.
const server = app.server(await sessionStore(), { files: join(board, 'public') });
server.listen(port, '127.0.0.1', () => {
  // A server that listens on a TCP port has an AddressInfo; a pipe or a closed server has none.
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`the board server listens on no TCP port: ${String(address)}`);
  process.stdout.write(`board on http://127.0.0.1:${address.port}\n`);
});
