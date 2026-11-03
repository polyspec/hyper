// The session store of a Redis server against a server in memory (HY-115): which commands it sends and what it keeps when
// the lock is taken or lost. tests/scripts/session-shared-redis.test.mts checks it on a real Redis server with PHP.
import { beforeEach, describe, expect, it } from 'vitest';
import { RedisSessions, SessionLockError } from '../src/index.js';
import { present } from './support.js';

const IDENTIFIER = 'a'.repeat(32);
const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const RECORD = 'a:1:{s:1:"n";i:0;}';
const bytes = (text: string): Uint8Array => Buffer.from(text);

describe('RedisSessions', () => {
  let keys: Map<string, Uint8Array>;
  let commands: string[];
  let sessions: RedisSessions;
  const text = (key: string): string => Buffer.from(present(keys.get(key))).toString();

  const command = (words: (string | Uint8Array)[]): Promise<unknown> => {
    const [name, first, second, third, fourth] = words;
    commands.push(String(name));
    const key = String(first);
    switch (name) {
      case 'EXISTS':
        return Promise.resolve(keys.has(key) ? 1 : 0);
      case 'GET':
        return Promise.resolve(keys.get(key) ?? null);
      case 'SET':
        if (keys.has(key)) return Promise.resolve(null);
        keys.set(key, bytes(String(second)));
        return Promise.resolve('OK');
      case 'SETEX':
        keys.set(key, third instanceof Uint8Array ? third : bytes(String(third)));
        return Promise.resolve('OK');
      case 'EXPIRE':
        return Promise.resolve(1);
      case 'EVAL': {
        const lock = String(third);
        if (keys.get(lock) === undefined || Buffer.from(present(keys.get(lock))).toString() !== String(fourth)) return Promise.resolve(0);
        keys.delete(lock);
        return Promise.resolve(1);
      }
      default:
        throw new Error(`the store sent ${String(name)}`);
    }
  };

  beforeEach(() => {
    keys = new Map([[KEY, bytes(RECORD)]]);
    commands = [];
    sessions = new RedisSessions({ command, lockRetries: 2, lockWait: 1 });
  });

  it('a request that finds the lock taken fails and changes nothing (HY-115)', async () => {
    keys.set(LOCK, bytes('another holder'));
    await expect(sessions.open(IDENTIFIER)).rejects.toBeInstanceOf(SessionLockError);
    expect(commands.filter((name) => name === 'SET')).toHaveLength(3);
    expect(text(KEY)).toBe(RECORD);
    expect(text(LOCK)).toBe('another holder');
  });

  it('a request that lost its lock writes nothing and fails (HY-115)', async () => {
    const session = await sessions.open(IDENTIFIER);
    session.set('n', 1);
    keys.set(LOCK, bytes('another holder'));
    await expect(session.close()).rejects.toBeInstanceOf(SessionLockError);
    expect(text(KEY)).toBe(RECORD);
    expect(text(LOCK)).toBe('another holder');
  });

  it('a request that changed nothing sets only a new expiry (HY-115)', async () => {
    const session = await sessions.open(IDENTIFIER);
    expect(session.get('n')).toBe(0);
    await session.close();
    expect(commands).toEqual(['EXISTS', 'SET', 'GET', 'GET', 'EXPIRE', 'EVAL']);
    expect(keys.has(LOCK)).toBe(false);
  });

  it('a reply that is not bytes fails and releases the lock (HY-115)', async () => {
    const replies = new RedisSessions({
      command: async (words) => {
        const reply = await command(words);
        return words[0] === 'GET' && reply instanceof Uint8Array ? Buffer.from(reply).toString() : reply;
      },
    });
    await expect(replies.open(IDENTIFIER)).rejects.toBeInstanceOf(TypeError);
    expect(keys.has(LOCK)).toBe(false);
  });
});
