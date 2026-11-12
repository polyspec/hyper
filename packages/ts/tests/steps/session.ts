// The steps of contracts/session.json (HY-24, HY-25, HY-40, HY-72, HY-104): the token, the flash values and the kept
// values that a session keeps in its store.
import { ArraySession } from '../../src/array-session.js';
import { Flash } from '../../src/flash.js';
import { Session } from '../../src/session.js';
import type { SessionStore } from '../../src/session-store.js';
import { toValue, type Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { textOf } from '../inputs.js';
import { callsOf, decoded } from './session-requests.js';

// Returns a map as the list of its pairs in iteration order, with the maps inside it written the same way.
function pairsOf(map: ReadonlyMap<string, unknown>): [string, unknown][] {
  return [...map].map(([key, item]): [string, unknown] => [key, item instanceof Map ? pairsOf(item) : item]);
}

// Returns the flash of the two arguments of putFlash: a map of values and a list of topics.
function flashOf(values: unknown, changed: unknown): Flash {
  if (!(values instanceof Map)) throw new Error('the flash values of a call are not a map');
  if (!Array.isArray(changed)) throw new Error('the changed topics of a call are not a list');
  const map = new Map<string, Value>();
  for (const [key, item] of values) map.set(textOf(key, 'a flash name of a call'), toValue(item));
  return new Flash(map, changed.map((topic: unknown) => textOf(topic, 'a changed topic of a call')));
}

// Applies one call to the session and returns its entry of `results`.
function applied(session: Session, [method, args]: [string, unknown[]]): unknown {
  switch (method) {
    case 'takeFlash': {
      const flash = session.takeFlash();
      return { values: pairsOf(flash.values), changed: flash.changed };
    }
    case 'putFlash':
      session.putFlash(flashOf(args[0], args[1]));
      return null;
    case 'keep':
      // @ts-expect-error -- the case gives keep a value that may lie outside the data model, which keep refuses (HY-40.4)
      session.keep(textOf(args[0], 'the region of a call'), textOf(args[1], 'the path of a call'), args[2]);
      return null;
    case 'csrfToken':
      return session.csrfToken();
    case 'renew':
      session.renew();
      return null;
    case 'kept':
      return pairsOf(session.kept(textOf(args[0], 'the region of a call')));
    default:
      throw new Error(`the method ${method} of the case is unknown`);
  }
}

// Puts the stored values of a case into a store, applies its calls until one fails with the stored-value error, an
// error of exactly the class Error, and compares the results of the calls that returned and the failure.
function stored(reader: CaseReader): void {
  const store = new ArraySession();
  const session = new Session(store);
  const pairs = reader.has('stored') ? reader.input('stored') : [];
  if (!Array.isArray(pairs)) throw new Error('the stored values of the case are not a list');
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('a stored value of the case is not a key and a JSON text');
    store.set(textOf(pair[0], 'a stored key of the case'), decoded(pair[1]));
  }
  const results: unknown[] = [];
  let error: string | null = null;
  let failed: string | null = null;
  for (const call of callsOf(reader.input('calls'))) {
    try {
      results.push(applied(session, call));
    } catch (failure) {
      // HY-40.4: keep of a value outside the data model fails with the error of the data model, a RangeError.
      if (call[0] === 'keep' && failure instanceof RangeError && reader.has('failure')) {
        failed = failure.message;
        break;
      }
      if (!(failure instanceof Error) || failure.constructor !== Error) throw failure;
      error = 'stored';
      break;
    }
  }
  reader.compare('results', results);
  reader.compare('error', error);
  if (failed !== null) reader.compare('failure', failed);
}

// Applies one call to the session store and returns its entry of `results`: the value of `get`, null for the others.
function storeCall(store: SessionStore, [method, args]: [string, unknown[]]): unknown {
  switch (method) {
    case 'get':
      return store.get(textOf(args[0], 'the key of a call')) ?? null;
    case 'set':
      store.set(textOf(args[0], 'the key of a call'), args[1]);
      return null;
    case 'remove':
      store.remove(textOf(args[0], 'the key of a call'));
      return null;
    case 'renew':
      store.renew();
      return null;
    default:
      throw new Error(`the method ${method} of the case is unknown`);
  }
}

export const steps = {
  // Applies the calls of the case and compares the tokens by the position of their first appearance, their form and
  // the renewals of the store.
  token(reader: CaseReader): void {
    const store = new ArraySession();
    const session = new Session(store);
    const distinct: string[] = [];
    const tokens: number[] = [];
    for (const call of callsOf(reader.input('calls'))) {
      const token = applied(session, call);
      if (call[0] === 'csrfToken') {
        if (typeof token !== 'string') throw new Error('csrfToken returned no text');
        if (!distinct.includes(token)) distinct.push(token);
        tokens.push(distinct.indexOf(token) + 1);
      } else if (call[0] !== 'renew') throw new Error(`the method ${call[0]} of the case is unknown`);
    }
    reader.compare('tokens', tokens);
    reader.compare('hexadecimal', distinct.every((token) => /^[0-9a-f]{64}$/u.test(token)));
    reader.compare('renewals', store.renewals());
  },
  flash: stored,
  kept: stored,
  // Applies the calls of the case to one ArraySession through the session store interface and compares what get
  // returned and the renewals that the ArraySession counts (HY-104, HY-72).
  store(reader: CaseReader): void {
    const session = new ArraySession();
    const store: SessionStore = session;
    reader.compare('results', callsOf(reader.input('calls')).map((call) => storeCall(store, call)));
    reader.compare('renewals', session.renewals());
  },
};
