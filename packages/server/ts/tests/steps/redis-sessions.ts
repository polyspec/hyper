// The steps of contracts/redis-sessions.json (HY-115): the commands that the requests of a case send to a Redis server
// in memory and the keys that it keeps, and the options that the store refuses.
import { RedisSessions, type RedisSessionsOptions } from '../../src/redis-sessions.js';
import { SessionLockError } from '../../src/session-lock-error.js';
import type { CaseReader } from '../case-reader.js';
import { bytesOf } from '../support.js';
import { requests, textOf } from './session-requests.js';

const RELEASE = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';

// A Redis server in memory: its keys with their bytes, the commands that it received, and the secrets of the locks
// that the store took. No key expires.
class MemoryRedis {
  readonly keys = new Map<string, Buffer>();
  private readonly received: string[][] = [];
  private readonly secrets = new Set<string>();
  private readonly textReplies: boolean;

  constructor(textReplies: boolean) {
    this.textReplies = textReplies;
  }

  // Runs one command and returns its reply: an integer, the text OK, the bytes of a key or null.
  command(words: (string | Uint8Array)[]): unknown {
    // Every word is text, with the bytes of a word as the characters U+0000 to U+00FF.
    const texts = words.map((word) => (typeof word === 'string' ? word : Buffer.from(word).toString('latin1')));
    this.received.push(texts);
    const [name, key, ...rest] = texts;
    if (name === undefined || key === undefined) throw new Error('the store sent a command without a key');
    // A value to store is bytes: a text is its UTF-8 bytes.
    const value = (index: number): Buffer => {
      const word = words[index];
      if (word === undefined) throw new Error(`the store sent ${name} without its value`);
      return typeof word === 'string' ? Buffer.from(word, 'utf8') : Buffer.from(word);
    };
    switch (name) {
      case 'EXISTS':
        return this.keys.has(key) ? 1 : 0;
      case 'GET': {
        const bytes = this.keys.get(key) ?? null;
        return bytes !== null && this.textReplies ? bytes.toString('utf8') : bytes;
      }
      case 'SET':
        if (rest[1] !== 'NX' || rest[2] !== 'PX' || rest.length !== 4) throw new Error('the store sent a SET that is not SET key value NX PX milliseconds');
        if (key.endsWith('_LOCK')) this.secrets.add(texts[2] ?? '');
        if (this.keys.has(key)) return null;
        this.keys.set(key, value(2));
        return 'OK';
      case 'SETEX':
        this.keys.set(key, value(3));
        return 'OK';
      case 'EXPIRE':
        return this.keys.has(key) ? 1 : 0;
      case 'DEL':
        return this.keys.delete(key) ? 1 : 0;
      case 'EVAL': {
        if (key !== RELEASE || rest[0] !== '1') throw new Error('the store sent an EVAL that is not the release of a lock');
        const lock = rest[1] ?? '';
        if (this.keys.get(lock)?.equals(value(4)) !== true) return 0;
        this.keys.delete(lock);
        return 1;
      }
      default:
        throw new Error(`the store sent the unknown command ${name}`);
    }
  }

  // Returns a word as a case writes it: `<secret>` for the secret of a lock and `<release>` for the release script.
  private written(word: string): string {
    if (this.secrets.has(word)) return '<secret>';
    return word === RELEASE ? '<release>' : word;
  }

  // Returns every received command in order, as the list of its words.
  commands(): string[][] {
    return this.received.map((words) => words.map((word) => this.written(word)));
  }

  // Returns the keys sorted, each with its bytes as text.
  stored(): [string, string][] {
    return [...this.keys]
      .map(([key, bytes]): [string, string] => [key, this.written(bytes.toString('latin1'))])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

// A command function that no case calls.
const unused = (): Promise<unknown> => Promise.reject(new Error('a store that fails to open sent a command'));

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    const redis = new MemoryRedis(reader.has('textReplies') && reader.input('textReplies') === true);
    const keys = reader.input('keys');
    if (!Array.isArray(keys)) throw new Error('the keys of the case are not a list');
    for (const pair of keys) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('a key of the case is not a key and its bytes');
      redis.keys.set(textOf(pair[0], 'a key of the case'), bytesOf(textOf(pair[1], 'the bytes of a key')));
    }
    const options: RedisSessionsOptions = { command: (words) => Promise.resolve().then(() => redis.command(words)) };
    const given = reader.has('options') ? reader.input('options') : new Map<string, unknown>();
    if (!(given instanceof Map)) throw new Error('the options of the case are not a map');
    for (const [name, value] of given) {
      if (typeof value !== 'number') throw new Error(`the option ${String(name)} of the case is not a number`);
      if (name === 'lockRetries') options.lockRetries = value;
      else if (name === 'lockWait') options.lockWait = value;
      else throw new Error(`the option ${String(name)} of the case is unknown`);
    }
    const sessions = new RedisSessions(options);
    const outcome = await requests(reader.input('steps'), {
      open: (cookie) => sessions.open(cookie),
      failure: (error) => {
        if (error instanceof SessionLockError) return 'lock';
        return error instanceof TypeError ? 'type' : null;
      },
      call: (method, args) => {
        if (method !== 'setKey') throw new Error(`the method ${method} of the case is unknown`);
        redis.keys.set(textOf(args[0], 'the key of a call'), bytesOf(textOf(args[1], 'the bytes of a call')));
        return undefined;
      },
      other: () => {
        throw new Error('a step of the case is no request');
      },
      identifiers: [],
      after: () => {},
    });
    reader.compare('results', outcome.results);
    reader.compare('created', outcome.created);
    reader.compare('errors', outcome.errors);
    reader.compare('commands', redis.commands());
    reader.compare('stored', redis.stored());
  },

  open(reader: CaseReader): void {
    const given = reader.input('options');
    if (!(given instanceof Map)) throw new Error('the options of the case are not a map');
    const options: Record<string, unknown> = { command: unused };
    for (const [name, value] of given) {
      if (name === 'lifetime') options.lifetime = value;
      else if (name === 'lockExpire') options.lockExpire = value;
      else throw new Error(`the option ${String(name)} of the case is unknown`);
    }
    let message: string | null = null;
    try {
      // @ts-expect-error -- a case gives the options as JSON values of any type, which the store checks (HY-115.21)
      new RedisSessions(options);
    } catch (error) {
      if (!(error instanceof Error) || error.constructor !== Error) throw error;
      message = error.message;
    }
    if (message === null) throw new Error('the store was made with the options of the case');
    reader.compare('error', message);
  },
};
