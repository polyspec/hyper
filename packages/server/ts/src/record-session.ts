// The session record that the PHP, Node and Python servers share, in the form php_serialize of PHP, and the part of a
// session store that holds its values, whatever keeps the record (HY-104, HY-115).
import { randomBytes } from 'node:crypto';
import { PhpFloat, Reference, serialize, StdClass, unserialize, type ArrayKey, type Value as Stored } from '@polyspec/php-serialize';
import type { SessionStore } from './session-store.js';

const IDENTIFIER = /^[A-Za-z0-9,-]{22,128}$/;

// The values of one session in one request (HY-24, HY-45, HY-72): the record as it was read and as the request changed
// it. A value that the request did not set stays what PHP wrote, so a request that does not change it writes the same
// bytes back. A store of a request extends this class and gives the record of its session with `stored`.
/** @internal */
export class RecordSession implements SessionStore {
  // The identifier of the session cookie, or null when the cookie names no session.
  protected readonly cookieId: string | null;
  // The values of the session by name, or null before the request used the session.
  protected items: Map<string | Uint8Array, Stored> | null;
  // The record as it was read, or null for a new session.
  protected read: Uint8Array | null;
  // The identifier of the session, whether this request made it, and the identifier that a renewal leaves.
  protected id: string | null;
  protected made: boolean;
  protected renewed: string | null;

  constructor(cookieId: string | null) {
    this.cookieId = cookieId;
    this.items = null;
    this.read = null;
    this.id = null;
    this.made = false;
    this.renewed = null;
  }

  // Returns the identifier that this request created, which the response sets as the session cookie, or null.
  created(): string | null {
    return this.made ? this.id : null;
  }

  get(key: string): unknown {
    return RecordSession.recordValue(this.start().get(key));
  }

  set(key: string, item: unknown): void {
    this.start().set(key, RecordSession.recorded(item));
  }

  remove(key: string): void {
    this.start().delete(key);
  }

  // Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old session
  // (HY-72).
  renew(): void {
    this.start();
    if (!this.made) this.renewed = this.id;
    this.id = randomBytes(32).toString('hex');
    this.made = true;
  }

  // Returns the record of the session of the cookie, or null when it names no session that can go on. The store of a
  // request gives it.
  stored(): Uint8Array | null {
    throw new Error('hyper: a record session has no record of its own');
  }

  // Returns the record to keep at closing, or null when the request did not use the session.
  serialized(): Uint8Array | null {
    return this.items === null || this.id === null ? null : serialize(this.items);
  }

  // Returns the value of a session cookie in the form of an identifier, or null (HY-104.9).
  static accepted(cookie: string | null): string | null {
    return cookie !== null && IDENTIFIER.test(cookie) ? cookie : null;
  }

  // Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
  static cookieName(secure: boolean): string {
    return secure ? '__Host-hy-session' : 'hy-session';
  }

  // Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45).
  static cookieHeader(id: string, secure: boolean): string {
    return `${RecordSession.cookieName(secure)}=${id}; path=/${secure ? '; secure' : ''}; HttpOnly; SameSite=Lax`;
  }

  // Returns the values of the session, which the first use of the request reads or starts.
  private start(): Map<string | Uint8Array, Stored> {
    if (this.items !== null) return this.items;
    const record = this.cookieId === null ? null : this.stored();
    if (record !== null && this.cookieId !== null) {
      this.read = record;
      this.items = RecordSession.recordValues(record, this.cookieId);
      this.id = this.cookieId;
      return this.items;
    }
    this.id = randomBytes(32).toString('hex');
    this.made = true;
    this.items = new Map();
    return this.items;
  }

  // Returns the key of the data model of an array key: an integer is its decimal text, and bytes that are not UTF-8 stay
  // bytes (HY-104.13).
  private static recordKey(key: ArrayKey): string | Uint8Array {
    return typeof key === 'number' || typeof key === 'bigint' ? String(key) : key;
  }

  // Returns the value of the data model of a value that a record holds: a float is its number, a stdClass is a map and a
  // reference is its value. Bytes that are not UTF-8 and an integer outside the data model stay what they are, and the
  // application fails on them as on any other value (HY-104.13).
  private static recordValue(stored: Stored | undefined): unknown {
    if (stored instanceof Reference) return RecordSession.recordValue(stored.value);
    if (stored instanceof PhpFloat) return stored.value;
    if (stored instanceof StdClass || stored instanceof Map) {
      const result = new Map<string | Uint8Array, unknown>();
      for (const [key, item] of stored instanceof StdClass ? stored.properties : stored) result.set(RecordSession.recordKey(key), RecordSession.recordValue(item));
      return result;
    }
    if (Array.isArray(stored)) return stored.map((item) => RecordSession.recordValue(item));
    return stored;
  }

  // Returns what the record holds for a value of the data model. A PHP array cannot tell an empty map or a map with the
  // keys 0 to n-1 from a list, so such a map is a stdClass, which PHP reads as a map of the data model (HY-104.14).
  // A value outside the data model fails here, in the request that stores it.
  private static recorded(input: unknown): Stored {
    if (Array.isArray(input)) return input.map((item: unknown) => RecordSession.recorded(item));
    if (input instanceof Map) {
      const items = new Map<string, Stored>();
      let index = 0;
      let listShaped = true;
      for (const [key, item] of input as Map<unknown, unknown>) {
        if (typeof key !== 'string') throw new TypeError('hyper: a session map has a key that is not a string');
        listShaped &&= key === String(index++);
        items.set(key, RecordSession.recorded(item));
      }
      return listShaped ? new StdClass(items) : items;
    }
    if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'bigint' || typeof input === 'string') return input;
    if (input instanceof Uint8Array || input instanceof PhpFloat || input instanceof StdClass || input instanceof Reference) return input;
    throw new TypeError('hyper: a session value is outside the data model');
  }

  // Returns the values of a session record by name. A record without bytes is an empty session, as PHP creates it, and any
  // other record that is no array fails the request (HY-104.8).
  private static recordValues(record: Uint8Array, id: string): Map<string | Uint8Array, Stored> {
    if (record.length === 0) return new Map();
    const stored = unserialize(record);
    if (Array.isArray(stored)) return new Map(stored.map((item, index) => [String(index), item]));
    if (stored instanceof Map) return new Map([...stored].map(([key, item]) => [RecordSession.recordKey(key), item]));
    throw new Error(`hyper: the session of ${id} holds no map of values`);
  }
}
