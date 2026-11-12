// The session record that the PHP, Node and Python servers share, in the form php_serialize of PHP, and the parts of a
// session store that do not depend on what keeps the record (HY-104, HY-115).
import { randomBytes } from 'node:crypto';
import { PhpFloat, Reference, serialize, StdClass, unserialize, type ArrayKey, type Value as Stored } from '@polyspec/php-serialize';
import type { SessionStore } from './session-store.js';

const IDENTIFIER = /^[A-Za-z0-9,-]{22,128}$/;

// Returns the value of a session cookie in the form of an identifier, or null.
export function accepted(cookie: string | null): string | null {
  return cookie !== null && IDENTIFIER.test(cookie) ? cookie : null;
}

// Returns the value of the data model of a value that a record holds: a float is its number, a stdClass is a map and a
// reference is its value. Bytes that are not UTF-8 and an integer outside the data model stay what they are, and the
// application fails on them as on any other value.
function value(stored: Stored | undefined): unknown {
  if (stored instanceof Reference) return value(stored.value);
  if (stored instanceof PhpFloat) return stored.value;
  if (stored instanceof StdClass) return map(stored.properties);
  if (stored instanceof Map) return map(stored);
  if (Array.isArray(stored)) return stored.map(value);
  return stored;
}

function map(stored: Map<ArrayKey, Stored>): Map<string | Uint8Array, unknown> {
  const result = new Map<string | Uint8Array, unknown>();
  for (const [key, item] of stored) result.set(keyOf(key), value(item));
  return result;
}

// Returns the key of the data model of an array key: an integer is its decimal text, and bytes that are not UTF-8 stay bytes.
function keyOf(key: ArrayKey): string | Uint8Array {
  return typeof key === 'number' || typeof key === 'bigint' ? String(key) : key;
}

// Returns what the record holds for a value of the data model. A PHP array cannot tell an empty map or a map with the
// keys 0 to n-1 from a list, so such a map is a stdClass, which PHP reads as a map of the data model.
// A value outside the data model fails here, in the request that stores it.
function recorded(input: unknown): Stored {
  if (Array.isArray(input)) return input.map(recorded);
  if (input instanceof Map) return recordedMap(input);
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'bigint' || typeof input === 'string') return input;
  if (input instanceof Uint8Array || input instanceof PhpFloat || input instanceof StdClass || input instanceof Reference) return input;
  throw new TypeError('hyper: a session value is outside the data model');
}

function recordedMap(input: Map<unknown, unknown>): Stored {
  const items = new Map<string, Stored>();
  let index = 0;
  let listShaped = true;
  for (const [key, item] of input) {
    if (typeof key !== 'string') throw new TypeError('hyper: a session map has a key that is not a string');
    listShaped &&= key === String(index++);
    items.set(key, recorded(item));
  }
  return listShaped ? new StdClass(items) : items;
}

// Returns the values of a session record by name. A record without bytes is an empty session, as PHP creates it, and any
// other record that is no array fails the request (HY-104).
function values(record: Uint8Array, where: string): Map<string | Uint8Array, Stored> {
  if (record.length === 0) return new Map();
  const stored = unserialize(record);
  if (Array.isArray(stored)) return new Map(stored.map((item, index) => [String(index), item]));
  if (stored instanceof Map) return new Map([...stored].map(([key, item]) => [keyOf(key), item]));
  throw new Error(`hyper: session ${where} holds no map of values`);
}

// Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-hy-session' : 'hy-session';
}

// Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45).
export function sessionCookie(id: string, secure: boolean): string {
  return `${sessionCookieName(secure)}=${id}; path=/${secure ? '; secure' : ''}; HttpOnly; SameSite=Lax`;
}

// The turns of the requests of one process: a request waits for the earlier requests of its session in this process, so
// that they do not try the lock against each other (HY-104, HY-115).
export class SessionTurns {
  private readonly queues = new Map<string, Promise<void>>();

  // Waits for the turn of an identifier and returns the function that ends the turn.
  async enter(id: string): Promise<() => void> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(id, queued);
    await previous;
    return () => {
      release();
      if (this.queues.get(id) === queued) this.queues.delete(id);
    };
  }
}

// The values of one session in one request: the record as it was read and as the request changed it. A value that the
// request did not set stays what PHP wrote, so a request that does not change it writes the same bytes back. `read`
// returns the record of the session of the cookie, or null when it names no session that can go on, and `where` tells
// where the record of an identifier is, for an error.
export class RecordSession implements SessionStore {
  private items: Map<string | Uint8Array, Stored> | null = null;
  private stored: Uint8Array | null = null;
  private id: string | null = null;
  private createdId = false;
  private renewedId: string | null = null;
  private readonly cookieId: string | null;
  private readonly read: () => Uint8Array | null;
  private readonly where: (id: string) => string;

  constructor(cookieId: string | null, read: () => Uint8Array | null, where: (id: string) => string) {
    this.cookieId = cookieId;
    this.read = read;
    this.where = where;
  }

  // True when the request read or wrote session data.
  /** @internal */
  get started(): boolean {
    return this.items !== null;
  }

  // The identifier that this request created, which the response sets as the session cookie, or null.
  /** @internal */
  get created(): string | null {
    return this.createdId ? this.id : null;
  }

  get(key: string): unknown {
    return value(this.start().get(key));
  }

  set(key: string, item: unknown): void {
    this.start().set(key, recorded(item));
  }

  remove(key: string): void {
    this.start().delete(key);
  }

  // Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old session
  // (HY-72).
  renew(): void {
    this.start();
    if (!this.createdId) this.renewedId = this.id;
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
  }

  // What closing keeps: the identifier, its record, whether the request made the identifier, whether it changed the
  // record, and the identifier that a renewal leaves. Null when the request did not use the session.
  /** @internal */
  pending(): { id: string; record: Uint8Array; created: boolean; changed: boolean; renewed: string | null } | null {
    if (this.items === null || this.id === null) return null;
    const record = serialize(this.items);
    const changed = this.stored === null || Buffer.compare(this.stored, record) !== 0;
    return { id: this.id, record, created: this.createdId, changed, renewed: this.renewedId };
  }

  private start(): Map<string | Uint8Array, Stored> {
    if (this.items !== null) return this.items;
    const record = this.cookieId === null ? null : this.read();
    if (record !== null && this.cookieId !== null) {
      this.stored = record;
      this.items = values(record, this.where(this.cookieId));
      this.id = this.cookieId;
      return this.items;
    }
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
    this.items = new Map();
    return this.items;
  }
}
