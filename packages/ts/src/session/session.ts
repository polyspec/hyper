// Session values of one browser session: the CSRF token, the flash values and the kept values (HY-24, HY-25,
// HY-40).
import { randomBytes } from 'node:crypto';
import { rules } from '../app/core-rules.js';
import { Flash } from './flash.js';
import type { SessionStore } from './session-store.js';
import { toValue, type MapValue, type Value } from '../data/values.js';

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

  // Returns the CSRF token, 64 lowercase hexadecimal digits, and creates it on first use (HY-24.1). A stored text of
  // another form fails, which the core checks (HY-24.14, HY-133.2).
  csrfToken(): string {
    const token = this.store.get(TOKEN);
    if (typeof token === 'string') return rules().sessionStoredToken(token);
    const created = randomBytes(32).toString('hex');
    this.store.set(TOKEN, created);
    return created;
  }

  // Moves the session to a new identifier and replaces its token (HY-72).
  renew(): void {
    this.store.renew();
    this.store.set(TOKEN, randomBytes(32).toString('hex'));
  }

  // Returns the stored flash data and removes it from the session. rules.flash_of of the core checks the stored flash
  // first: one of another form fails with invalid_session_record (HY-25.2, HY-104.23), and a flash map without
  // `values` or without `changed` has none.
  takeFlash(): Flash {
    const stored = this.store.get(FLASH);
    if (stored === undefined || stored === null) {
      // HY-120.6: the opening of the session reads and removes the flash data, also when it holds none.
      this.store.remove(FLASH);
      return new Flash(new Map<string, Value>(), []);
    }
    const flash = Session.coreMap(rules().sessionFlashOf(stored));
    this.store.remove(FLASH);
    const changed = flash.get('changed');
    const topics = Array.isArray(changed) ? changed.filter((topic): topic is string => typeof topic === 'string') : [];
    return new Flash(Session.coreMap(flash.get('values') ?? new Map()), topics);
  }

  // Stores flash data for the next request.
  putFlash(flash: Flash): void {
    this.store.set(FLASH, new Map<string, unknown>([['values', new Map(flash.values)], ['changed', [...flash.changed]]]));
  }

  // Stores a kept value of a region (HY-38, HY-40). rules.kept_of of the core checks the stored kept values, those of
  // every region (HY-104.23).
  keep(region: string, path: string, value: Value): void {
    const kept = this.storedKept();
    kept.set(region, new Map(Session.coreMap(kept.get(region) ?? new Map())).set(path, toValue(value)));
    this.store.set(KEEP, kept);
  }

  // Returns the kept values of a region in storing order, an empty map for a region that stored none (HY-40.3).
  // rules.kept_of of the core checks the stored kept values (HY-104.23).
  kept(region: string): MapValue {
    return Session.coreMap(this.storedKept().get(region) ?? new Map());
  }

  // The stored kept values by region, which rules.kept_of of the core checks and which fail with
  // invalid_session_record for kept values of another form (HY-104.22, HY-104.23).
  private storedKept(): MapValue {
    const stored = this.store.get(KEEP);
    if (stored === undefined || stored === null) return new Map<string, Value>();
    return new Map(Session.coreMap(rules().sessionKeptOf(stored)));
  }

  // Returns a stored map as it is: a value read from the store enters the data model without a check (HY-104.13), and
  // a kept value that does not conform is ignored at render (HY-38.7). A value that is not a map gives an empty map.
  private static coreMap(value: unknown): MapValue {
    return value instanceof Map ? (value as MapValue) : new Map<string, Value>();
  }
}
