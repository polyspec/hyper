// Several server processes that use one session at the same time (HY-104). Each process has its own session store, as each
// worker process of one server has, so only the lock of the session holds the other processes back.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { deserialize, serialize } from 'node:v8';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PROCESSES = 4;
const REQUESTS = 200;
// One server process: it runs the requests of one session, each reading the token and adding one to the count, as a form
// post reads the CSRF token and writes a flash value, and prints the requests that found no session as JSON. It imports
// the built package, which `make packages` writes before the Node server tests.
const PROCESS = `
import { FileSessions } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../dist/index.js')).href)};
const [directory, id, requests] = process.argv.slice(1);
const sessions = new FileSessions({ directory });
const failures = [];
for (let request = 0; request < Number(requests); request++) {
  const session = await sessions.open(id);
  try {
    if (session.get('token') === undefined) failures.push('a request started the new session ' + session.created);
    session.set('count', (session.get('count') ?? 0) + 1);
  } finally {
    await session.close();
  }
}
process.stdout.write(JSON.stringify(failures));
`;

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-sessions-race-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('FileSessions in several processes', () => {
  it('runs the requests of one session in several processes one after another (HY-104)', async () => {
    const id = 'a'.repeat(64);
    writeFileSync(join(directory, id), serialize(new Map<string, unknown>([['token', 't'], ['count', 0]])));
    const outputs = await Promise.all(
      Array.from({ length: PROCESSES }, () => promisify(execFile)(process.execPath, ['--input-type=module', '--eval', PROCESS, directory, id, String(REQUESTS)])),
    );
    expect(outputs.map(({ stdout }): unknown => JSON.parse(stdout))).toEqual(Array.from({ length: PROCESSES }, () => []));
    const stored: unknown = deserialize(readFileSync(join(directory, id)));
    expect(stored instanceof Map ? stored.get('count') : stored, 'expected every request to add one to the count').toBe(PROCESSES * REQUESTS);
  }, 120_000);
});
