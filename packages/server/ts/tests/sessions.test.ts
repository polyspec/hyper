// Sessions in files beyond the cases of contracts/file-sessions.json (HY-104): the order of the requests of one session
// (HY-104.6).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessions } from '../src/index.js';
import { present } from './support.js';

let directory: string;
let sessions: FileSessions;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-sessions-'));
  sessions = new FileSessions({ directory });
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('FileSessions', () => {
  it('runs the requests of one session one after another', async () => {
    const first = await sessions.open(null);
    first.set('n', 1);
    await first.close();
    const id = present(first.created());
    const order: string[] = [];
    const a = await sessions.open(id);
    const opening = sessions.open(id).then(async (b) => {
      order.push(`b reads ${String(b.get('n'))}`);
      await b.close();
    });
    await new Promise((resolve) => setImmediate(resolve));
    order.push('a writes 2');
    a.set('n', 2);
    await a.close();
    await opening;
    expect(order).toEqual(['a writes 2', 'b reads 2']);
  });
});
