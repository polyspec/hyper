// The HTTP servers of the board over one session store (HY-115): real requests that share a session by its cookie.
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';

import { startNode, startPhp, startPython } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';
import { ROOT } from './session-workers.mts';

const BOARD = path.join(ROOT, 'examples/board');

// Fails unless the workers and the board of a session test are built.
export function requireServers(): void {
  requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  requireBuilt('node-server', 'examples/board/build/node/server.mjs');
  requireBuilt('server', 'examples/board/build/server');
}

// One server of the board and its address.
export interface Board { name: string; url: string }

// Starts the PHP, Node and Python servers of the board. `ini` adds to the settings of PHP that keep sessions through phpredis.
export async function startBoards(children: ChildProcess[], env: Record<string, string>, ini: string[]): Promise<Board[]> {
  const php = await startPhp({
    name: 'php',
    app: BOARD,
    port: 0,
    env,
    ini: [`extension=${path.join(ROOT, 'var/redis/redis.so')}`, 'session.save_handler=redis', 'redis.session.locking_enabled=1', 'redis.session.lock_expire=30', ...ini],
    children,
  });
  const node = await startNode({ name: 'node', app: BOARD, port: 0, env, children });
  const python = await startPython({ name: 'python', app: BOARD, port: 0, env, children });
  return [{ name: 'php', url: php.url }, { name: 'node', url: node.url }, { name: 'python', url: python.url }];
}

export const cookieOf = (response: Response): string => {
  const cookie = response.headers.getSetCookie().find((line) => line.startsWith('hy-session='));
  assert.notEqual(cookie, undefined, 'the response sets the session cookie');
  return String(cookie).split(';')[0] ?? '';
};
export const tokenOf = (body: string): string => {
  const token = /name="_csrf" value="([^"]+)"/.exec(body)?.[1];
  assert.notEqual(token, undefined, 'the form holds the CSRF token');
  return String(token);
};

// Posts the form of the board with the cookie and the token of a session.
export const post = (board: Board, cookie: string, token: string, title: string): Promise<Response> => fetch(`${board.url}/board/create`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie, origin: board.url, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: token, title, author: board.name, body: 'text' }),
});

// Opens a session on each server, posts its token on another and reads the flash value on the third, in every order.
export async function shareAcross(boards: Board[]): Promise<{ cookie: string; token: string }[]> {
  const sessions: { cookie: string; token: string }[] = [];
  for (const [index, first] of boards.entries()) {
    for (const offset of [1, 2]) {
      const second = boards[(index + offset) % boards.length];
      const third = boards[(index + 3 - offset) % boards.length];
      assert.ok(second !== undefined && third !== undefined);
      const opened = await fetch(`${first.url}/board/create`);
      assert.equal(opened.status, 200, `${first.name} opens the form`);
      const cookie = cookieOf(opened);
      const token = tokenOf(await opened.text());
      const posted = await post(second, cookie, token, `${first.name} ${second.name}`);
      assert.equal(posted.status, 303, `${second.name} accepts the token that ${first.name} issued`);
      const page = await (await fetch(`${third.url}/board`, { headers: { cookie } })).text();
      const later = await (await fetch(`${third.url}/board`, { headers: { cookie } })).text();
      assert.match(page, /class="new"/, `${third.name} reads the flash value that ${second.name} wrote`);
      assert.doesNotMatch(later, /class="new"/, `${third.name} took the flash value once`);
      sessions.push({ cookie, token });
    }
  }
  return sessions;
}
