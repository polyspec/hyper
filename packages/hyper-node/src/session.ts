// Session values of one browser session: the CSRF token, the flash values and the kept values (HY-24, HY-25,
// HY-40).
import { randomBytes } from 'node:crypto';
import { toValue, type MapValue, type Value } from './values.js';

// Stores the values of one browser session. `FileSessions` gives one store per request; `MemorySessionStore`
// keeps one session in memory for tests.
export interface SessionStore {
  // Returns the value stored under a key, or undefined.
  get(key: string): unknown;
  // Stores a value under a key.
  set(key: string, value: unknown): void;
  // Removes the value stored under a key.
  remove(key: string): void;
  // Moves the values to a new session identifier and deletes the old session (HY-72).
  renew(): void;
}

// Stores the values of one session in memory.
export class MemorySessionStore implements SessionStore {
  private readonly values = new Map<string, unknown>();
  private renewed = 0;

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  // Counts the renewals; the values have no identifier in memory (HY-72).
  renew(): void {
    this.renewed++;
  }

  // The number of renewals.
  get renewals(): number {
    return this.renewed;
  }
}

// Values and changed topics that an action passes to the next request (HY-25).
export interface Flash {
  values: Map<string, Value>;
  changed: string[];
}

const TOKEN = '_hyper_csrf';
const FLASH = '_hyper_flash';
const KEEP = '_hyper_keep';

// Owns the CSRF token, the flash data and the kept values of one session.
export class Session {
  private readonly store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  // Returns the CSRF token, 64 lowercase hexadecimal digits, and creates it on first use or over another value (HY-24).
  csrfToken(): string {
    const token = this.store.get(TOKEN);
    if (typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)) return token;
    const created = randomBytes(32).toString('hex');
    this.store.set(TOKEN, created);
    return created;
  }

  // Moves the session to a new identifier and replaces its token (HY-72).
  renew(): void {
    this.store.renew();
    this.store.set(TOKEN, randomBytes(32).toString('hex'));
  }

  // Returns the stored flash data and removes it from the session.
  takeFlash(): Flash {
    const flash = this.store.get(FLASH);
    this.store.remove(FLASH);
    if (!(flash instanceof Map)) return { values: new Map(), changed: [] };
    const values = flash.get('values');
    const changed = flash.get('changed');
    return {
      values: values instanceof Map ? (values as Map<string, Value>) : new Map(),
      changed: Array.isArray(changed) ? changed.filter((topic): topic is string => typeof topic === 'string') : [],
    };
  }

  // Stores flash data for the next request.
  putFlash(flash: Flash): void {
    this.store.set(FLASH, new Map<string, unknown>([['values', new Map(flash.values)], ['changed', [...flash.changed]]]));
  }

  // Stores a kept value of a region (HY-39, HY-40).
  keep(region: string, path: string, value: Value): void {
    const stored = this.store.get(KEEP);
    const kept = new Map(stored instanceof Map ? (stored as Map<string, MapValue>) : []);
    kept.set(region, new Map(kept.get(region) ?? []).set(path, toValue(value)));
    this.store.set(KEEP, kept);
  }

  // Returns the kept values of a region in storing order.
  kept(region: string): MapValue {
    const stored = this.store.get(KEEP);
    const values = stored instanceof Map ? stored.get(region) : undefined;
    return values instanceof Map ? values : new Map();
  }
}
