// Sessions in files (HY-45), the counterpart of packages/hyper-php/tests/NativeSessionTest.php and the session
// cookie options of RequestTest.php.
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessions } from '../src/index.js';

let directory: string;
let sessions: FileSessions;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-sessions-'));
  sessions = new FileSessions({ directory, name: 'PHPSESSID' });
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('FileSessions', () => {
  it('starts the session on first use and creates no file for a request that does not use it', async () => {
    const unused = await sessions.open(null);
    unused.close();
    expect(unused.started).toBe(false);
    expect(readdirSync(directory)).toEqual([]);

    const session = await sessions.open(null);
    session.set('a', new Map([['b', [1, -0, 'c']]]));
    session.close();
    expect(session.started).toBe(true);
    expect(session.created).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(directory)).toEqual([session.created]);
  });

  it('reads a session that it created and sets no new cookie for it', async () => {
    const first = await sessions.open(null);
    first.set('a', new Map([['b', [1, -0, 'c']]]));
    first.close();
    const second = await sessions.open(first.created);
    expect(second.get('a')).toEqual(new Map([['b', [1, -0, 'c']]]));
    expect(Object.is((second.get('a') as Map<string, number[]>).get('b')![1], -0)).toBe(true);
    second.close();
    expect(second.created).toBeNull();
  });

  it('accepts only identifiers that it created (HY-45)', async () => {
    for (const cookie of ['abc', '../../etc/passwd', 'f'.repeat(64), 'F'.repeat(64)]) {
      const session = await sessions.open(cookie);
      expect(session.get('a'), cookie).toBeUndefined();
      expect(session.created, cookie).not.toBe(cookie);
      expect(session.created, cookie).toMatch(/^[0-9a-f]{64}$/);
      session.close();
    }
  });

  it('ends a session after its lifetime and removes expired files', async () => {
    const first = await sessions.open(null);
    first.set('a', 1);
    first.close();
    const id = first.created!;
    const old = new Date(Date.now() - 1441 * 1000);
    utimesSync(join(directory, id), old, old);
    const later = await sessions.open(id);
    expect(later.get('a')).toBeUndefined();
    expect(later.created).not.toBe(id);
    later.close();
    expect(sessions.collect()).toBe(1);
    expect(existsSync(join(directory, id))).toBe(false);
  });

  it('runs the requests of one session one after another', async () => {
    const first = await sessions.open(null);
    first.set('n', 1);
    first.close();
    const id = first.created!;
    const order: string[] = [];
    const a = await sessions.open(id);
    const opening = sessions.open(id).then((b) => {
      order.push(`b reads ${String(b.get('n'))}`);
      b.close();
    });
    await new Promise((resolve) => setImmediate(resolve));
    order.push('a writes 2');
    a.set('n', 2);
    a.close();
    await opening;
    expect(order).toEqual(['a writes 2', 'b reads 2']);
  });

  it('writes the session cookie with the attributes of the PHP session (HY-45)', () => {
    expect(sessions.cookie('a'.repeat(64), false)).toBe(`PHPSESSID=${'a'.repeat(64)}; path=/; HttpOnly; SameSite=Lax`);
    expect(sessions.cookie('a'.repeat(64), true)).toBe(`PHPSESSID=${'a'.repeat(64)}; path=/; secure; HttpOnly; SameSite=Lax`);
  });

  it('requires an existing absolute directory, a cookie name and a positive lifetime', () => {
    expect(() => new FileSessions({ directory: 'var/sessions', name: 'a' })).toThrow('absolute');
    expect(() => new FileSessions({ directory, name: 'a b' })).toThrow('cookie name');
    expect(() => new FileSessions({ directory, name: 'a', lifetime: 0 })).toThrow('lifetime');
  });
});
