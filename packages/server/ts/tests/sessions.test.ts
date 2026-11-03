// Sessions in files (HY-45), the counterpart of packages/server/php/tests/NativeSessionTest.php and the session
// cookie options of RequestTest.php.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize, UnserializeError } from '@polyspec/php-serialize';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessions } from '../src/index.js';
import { sessionCookie, sessionCookieName } from '../src/session-record.js';
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
  it('starts the session on first use and creates no file for a request that does not use it', async () => {
    const unused = await sessions.open(null);
    await unused.close();
    expect(unused.started).toBe(false);
    expect(readdirSync(directory)).toEqual([]);

    const session = await sessions.open(null);
    session.set('a', new Map([['b', [1, -0, 'c']]]));
    await session.close();
    expect(session.started).toBe(true);
    expect(session.created).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(directory)).toEqual([`sess_${String(session.created)}`]);
  });

  it('fails for a session file that holds no array by name', async () => {
    const id = 'e'.repeat(64);
    const file = join(directory, `sess_${id}`);
    writeFileSync(file, serialize(1));
    const session = await sessions.open(id);
    expect(() => session.get('a')).toThrow(`hyper: session file ${file} holds no map of values`);
    await session.close();
  });

  it('fails for a session file that it cannot read and starts no new session (HY-104)', async () => {
    const id = 'e'.repeat(64);
    writeFileSync(join(directory, `sess_${id}`), 's:5:"token');
    const session = await sessions.open(id);
    expect(() => session.get('token')).toThrow(UnserializeError);
    await session.close();
    expect(session.created).toBeNull();
  });

  it('creates no file for an identifier without a session', async () => {
    const unknown = await sessions.open('e'.repeat(64));
    expect(readdirSync(directory)).toEqual([]);
    await unknown.close();
    expect(readdirSync(directory)).toEqual([]);
  });

  it('reads a session file without bytes as an empty session (HY-104)', async () => {
    const id = 'a'.repeat(32);
    writeFileSync(join(directory, `sess_${id}`), '');
    const session = await sessions.open(id);
    expect(session.get('a')).toBeUndefined();
    await session.close();
    expect(session.created).toBeNull();
    expect(readFileSync(join(directory, `sess_${id}`), 'latin1')).toBe('a:0:{}');
  });

  it('keeps the bytes of the record when a request changes nothing (HY-104)', async () => {
    const id = 'a'.repeat(32);
    const file = join(directory, `sess_${id}`);
    const record = 'a:3:{s:1:"f";d:1;s:1:"o";O:8:"stdClass":1:{s:1:"0";i:1;}s:1:"r";a:2:{i:0;a:0:{}i:1;R:5;}}';
    writeFileSync(file, record, 'latin1');
    const old = new Date(Date.now() - 100_000);
    utimesSync(file, old, old);
    const session = await sessions.open(id);
    expect(session.get('o')).toEqual(new Map([['0', 1]]));
    expect(session.get('f')).toBe(1);
    await session.close();
    expect(readFileSync(file, 'latin1')).toBe(record);
    expect(statSync(file).mtimeMs).toBeGreaterThan(old.getTime() + 50_000);
    const changed = await sessions.open(id);
    changed.set('n', 1);
    await changed.close();
    expect(readFileSync(file, 'latin1')).toBe(`${record.slice(0, -1).replace('a:3:', 'a:4:')}s:1:"n";i:1;}`);
  });

  it('leaves no bytes of a longer record behind a shorter one', async () => {
    const id = 'a'.repeat(32);
    const file = join(directory, `sess_${id}`);
    writeFileSync(file, serialize(new Map([['a', 'x'.repeat(100)]])));
    const session = await sessions.open(id);
    session.remove('a');
    await session.close();
    expect(readFileSync(file, 'latin1')).toBe('a:0:{}');
  });

  it('reads the values of PHP arrays as the data model (HY-104)', async () => {
    const id = 'a'.repeat(32);
    writeFileSync(join(directory, `sess_${id}`), 'a:3:{i:0;s:1:"z";s:1:"m";a:2:{i:7;s:1:"x";s:1:"y";i:1;}s:1:"o";O:8:"stdClass":0:{}}', 'latin1');
    const session = await sessions.open(id);
    expect(session.get('0')).toBe('z');
    expect(session.get('m')).toEqual(new Map<string, unknown>([['7', 'x'], ['y', 1]]));
    expect(session.get('o')).toEqual(new Map());
    await session.close();
  });

  it('keeps a map that a PHP array would read as a list (HY-104)', async () => {
    const first = await sessions.open(null);
    first.set('empty', new Map());
    first.set('numbered', new Map([['0', 'a'], ['1', 'b']]));
    first.set('list', ['a']);
    await first.close();
    const id = present(first.created);
    expect(readFileSync(join(directory, `sess_${id}`), 'latin1')).toBe(
      'a:3:{s:5:"empty";O:8:"stdClass":0:{}s:8:"numbered";O:8:"stdClass":2:{s:1:"0";s:1:"a";s:1:"1";s:1:"b";}s:4:"list";a:1:{i:0;s:1:"a";}}',
    );
    const later = await sessions.open(id);
    expect(later.get('empty')).toEqual(new Map());
    expect(later.get('numbered')).toEqual(new Map([['0', 'a'], ['1', 'b']]));
    expect(later.get('list')).toEqual(['a']);
    await later.close();
  });

  it('reads a session that it created and sets no new cookie for it', async () => {
    const first = await sessions.open(null);
    first.set('a', new Map([['b', [1, -0, 'c']]]));
    await first.close();
    const second = await sessions.open(first.created);
    expect(second.get('a')).toEqual(new Map([['b', [1, -0, 'c']]]));
    const stored = second.get('a');
    const numbers: unknown = stored instanceof Map ? stored.get('b') : undefined;
    expect(Array.isArray(numbers) && Object.is(numbers[1], -0)).toBe(true);
    await second.close();
    expect(second.created).toBeNull();
  });

  it('accepts only identifiers that it created (HY-45)', async () => {
    for (const cookie of ['abc', '../../etc/passwd', 'f'.repeat(64), 'F'.repeat(64), 'a'.repeat(129)]) {
      const session = await sessions.open(cookie);
      expect(session.get('a'), cookie).toBeUndefined();
      expect(session.created, cookie).not.toBe(cookie);
      expect(session.created, cookie).toMatch(/^[0-9a-f]{64}$/);
      await session.close();
    }
  });

  it('ends a session after its lifetime and removes expired files', async () => {
    const first = await sessions.open(null);
    first.set('a', 1);
    await first.close();
    const id = present(first.created);
    const old = new Date(Date.now() - 1441 * 1000);
    utimesSync(join(directory, `sess_${id}`), old, old);
    const later = await sessions.open(id);
    expect(later.get('a')).toBeUndefined();
    expect(later.created).not.toBe(id);
    await later.close();
    expect(sessions.collect()).toBe(1);
    expect(existsSync(join(directory, `sess_${id}`))).toBe(false);
  });

  it('runs the requests of one session one after another', async () => {
    const first = await sessions.open(null);
    first.set('n', 1);
    await first.close();
    const id = present(first.created);
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

  it('names the session cookie hy-session over HTTP and __Host-hy-session over HTTPS (HY-45)', () => {
    expect(sessionCookieName(false)).toBe('hy-session');
    expect(sessionCookieName(true)).toBe('__Host-hy-session');
    expect(sessionCookie('a'.repeat(64), false)).toBe(`hy-session=${'a'.repeat(64)}; path=/; HttpOnly; SameSite=Lax`);
    expect(sessionCookie('a'.repeat(64), true)).toBe(`__Host-hy-session=${'a'.repeat(64)}; path=/; secure; HttpOnly; SameSite=Lax`);
  });

  it('renews a session: a new identifier with the same values, and no file of the old one (HY-72)', async () => {
    const first = await sessions.open(null);
    first.set('a', 1);
    await first.close();
    const old = present(first.created);
    const session = await sessions.open(old);
    session.renew();
    await session.close();
    expect(session.created).toMatch(/^[0-9a-f]{64}$/);
    expect(session.created).not.toBe(old);
    expect(readdirSync(directory)).toEqual([`sess_${String(session.created)}`]);
    const next = await sessions.open(session.created);
    expect(next.get('a')).toBe(1);
    await next.close();
    const stale = await sessions.open(old);
    expect(stale.get('a')).toBeUndefined();
    await stale.close();
  });

  it('requires an existing absolute directory and a positive lifetime', () => {
    expect(() => new FileSessions({ directory: 'var/sessions' })).toThrow('absolute');
    expect(() => new FileSessions({ directory, lifetime: 0 })).toThrow('lifetime');
  });
});
