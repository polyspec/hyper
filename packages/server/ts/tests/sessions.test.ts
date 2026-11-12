// Sessions in files beyond the cases of contracts/file-sessions.json (HY-104): the form of an error message of the Node
// server (HY-106.10) and the order of the requests of one session (HY-104.6).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from '@polyspec/php-serialize';
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
  it('starts the message of a session file that holds no array with hyper: (HY-106.10)', async () => {
    const id = 'e'.repeat(64);
    writeFileSync(join(directory, `sess_${id}`), serialize(1));
    const session = await sessions.open(id);
    expect(() => session.get('a')).toThrow(/^hyper: /);
    await session.close();
  });

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
