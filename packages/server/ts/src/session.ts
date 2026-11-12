// Session values of one browser session: the CSRF token, the flash values and the kept values (HY-24, HY-25,
// HY-40).
import { randomBytes } from 'node:crypto';
import { Flash } from './flash.js';
import type { SessionStore } from './session-store.js';
import { isMapValue, toValue, type MapValue, type Value } from './values.js';

const TOKEN = '_hyper_csrf';
const FLASH = '_hyper_flash';
const KEEP = '_hyper_keep';

// Owns the CSRF token, the flash data and the kept values of one session.
/** @internal */
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
    if (!(flash instanceof Map)) return new Flash(new Map<string, Value>(), []);
    const values: unknown = flash.get('values');
    const changed: unknown = flash.get('changed');
    return new Flash(
      values instanceof Map || Array.isArray(values) ? Session.storedMap(values) : new Map<string, Value>(),
      Array.isArray(changed) ? changed.filter((topic): topic is string => typeof topic === 'string') : [],
    );
  }

  // Stores flash data for the next request.
  putFlash(flash: Flash): void {
    this.store.set(FLASH, new Map<string, unknown>([['values', new Map(flash.values)], ['changed', [...flash.changed]]]));
  }

  // Stores a kept value of a region (HY-38, HY-40).
  keep(region: string, path: string, value: Value): void {
    const stored = this.store.get(KEEP);
    const kept = new Map<string, MapValue>();
    if (stored instanceof Map) {
      for (const [name, values] of stored) {
        if (typeof name !== 'string') throw new Error('hyper: the session holds kept values under a region name that is not a string');
        kept.set(name, Session.storedMap(values));
      }
    }
    kept.set(region, new Map(kept.get(region) ?? []).set(path, toValue(value)));
    this.store.set(KEEP, kept);
  }

  // Returns the kept values of a region in storing order.
  kept(region: string): MapValue {
    const stored = this.store.get(KEEP);
    const values: unknown = stored instanceof Map ? stored.get(region) : undefined;
    return values instanceof Map || Array.isArray(values) ? Session.storedMap(values) : new Map<string, Value>();
  }


  // Returns the map of a stored value, which the session stored with toValue; another value fails, since the session
  // holds only those. PHP keeps a map as an array, and an array with the keys 0 to n-1 reads as a list, so a list here
  // is that map.
  private static storedMap(value: unknown): MapValue {
    const map = Array.isArray(value) ? new Map(value.map((item: unknown, index) => [String(index), item])) : value;
    if (!isMapValue(map)) throw new Error('hyper: the session holds flash or kept values that are not a map of values');
    return map;
  }
}
