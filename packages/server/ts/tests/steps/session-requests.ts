// The requests of the cases of contracts/file-sessions.json and contracts/redis-sessions.json (HY-104, HY-115): each
// step of a case opens the store of one request, applies its calls and closes it.
import { parsed } from '../case-rules.js';
import { textOf } from '../inputs.js';

// A call of a case: a method and the decoded values of its arguments.
type Call = [string, unknown[]];

// The store of one request, as the session stores of the server give it.
interface RequestStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  renew(): void;
  created(): string | null;
  close(): Promise<void>;
}

// What a case file gives the requests of its cases.
interface Host {
  // Opens the store of a request with the value of its session cookie.
  open(cookie: string | null): Promise<RequestStore>;
  // Returns the name that the case file gives the class of a failure, or null for a class that it does not name.
  failure(error: unknown): string | null;
  // Runs a call that is no method of the store, with the identifiers that the steps created so far, and returns its
  // entry of `results`, or undefined for a call without one.
  call(method: string, args: unknown[], made: readonly (string | null)[]): unknown;
  // Runs a step that is no request and returns its entry of `results`.
  other(step: Map<unknown, unknown>): unknown[];
  // The identifiers that the case names, which a created identifier differs from.
  identifiers: readonly string[];
  // Runs after each step, with the identifiers that the steps created so far.
  after(made: readonly (string | null)[]): void;
}

// What the steps of a case gave: the results, the created identifier and the first failure of each step, and the
// message of the first failure of the case, or the empty text.
interface Outcome {
  results: unknown[][];
  created: (string | null)[];
  errors: ([string, string] | null)[];
  message: string;
}

// Returns the value of a JSON text of a case as a caller gives it: a Map in document order for an object.
export function decoded(text: unknown): unknown {
  if (typeof text !== 'string') throw new Error('an argument of the case is not a JSON text');
  return parsed(text);
}

// Returns the calls of a case with their decoded arguments, and fails for a call of another form.
export function callsOf(value: unknown): Call[] {
  if (!Array.isArray(value)) throw new Error('the calls of the case are not a list');
  return value.map((entry: unknown): Call => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) throw new Error('a call of the case is not a method and a list of JSON texts');
    return [entry[0], entry[1].map((text: unknown) => decoded(text))];
  });
}

// Returns the cookie value of a step: null, a text, or the identifier that an earlier step created.
function cookieOf(value: unknown, made: readonly (string | null)[]): string | null {
  if (value === null || typeof value === 'string') return value;
  const index: unknown = value instanceof Map ? value.get('created') : undefined;
  if (typeof index !== 'number') throw new Error('the cookie of a step is not null, a text or the step that created it');
  const identifier = made[index];
  if (identifier === undefined || identifier === null) throw new Error(`the step ${index} created no identifier`);
  return identifier;
}

// Applies one call to the store of a request and returns its entry of `results`, or undefined for a call without one.
function applied(store: RequestStore, [method, args]: Call, host: Host, made: readonly (string | null)[]): unknown {
  switch (method) {
    case 'get': {
      // The value that the store read, null for no value (HY-104.13, HY-115.4).
      return store.get(textOf(args[0], 'the key of a call')) ?? null;
    }
    case 'set':
      store.set(textOf(args[0], 'the key of a call'), args[1]);
      return undefined;
    case 'remove':
      store.remove(textOf(args[0], 'the key of a call'));
      return undefined;
    case 'renew':
      store.renew();
      return undefined;
    default:
      return host.call(method, args, made);
  }
}

// Runs the steps of a case in order. A request opens its store, applies its calls until one fails, and closes the store
// after a successful open; its first failure is `[where, class]`, and a failure of a class that the case file does not
// name is an error of the step.
export async function requests(steps: unknown, host: Host): Promise<Outcome> {
  if (!Array.isArray(steps)) throw new Error('the steps of the case are not a list');
  const outcome: Outcome = { results: [], created: [], errors: [], message: '' };
  const made: (string | null)[] = [];
  let failed = false;
  for (const step of steps) {
    if (!(step instanceof Map)) throw new Error('a step of the case is not a map');
    if (!step.has('calls')) {
      outcome.results.push(host.other(step));
      outcome.created.push(null);
      outcome.errors.push(null);
      made.push(null);
      host.after(made);
      continue;
    }
    const cookie = cookieOf(step.get('cookie'), made);
    const results: unknown[] = [];
    let first: [string, string] | null = null;
    // Records the first failure of the request, and fails the step for a class that the case file does not name.
    const fail = (where: string, error: unknown): void => {
      const name = host.failure(error);
      if (name === null) throw error;
      first ??= [where, name];
      if (!failed) outcome.message = error instanceof Error ? error.message : String(error);
      failed = true;
    };
    let store: RequestStore | null = null;
    try {
      store = await host.open(cookie);
    } catch (error) {
      fail('open', error);
    }
    let created: string | null = null;
    if (store !== null) {
      // The store is closed also after a failed call, and the first of the two failures counts.
      const failures: [string, unknown][] = [];
      try {
        for (const call of callsOf(step.get('calls'))) {
          const result = applied(store, call, host, made);
          if (result !== undefined) results.push(result);
        }
      } catch (error) {
        failures.push(['call', error]);
      }
      try {
        await store.close();
      } catch (error) {
        failures.push(['close', error]);
      }
      for (const [where, error] of failures) fail(where, error);
      created = store.created();
    }
    // An identifier that the store made is written `new`; any other value is given as it is.
    const fresh = created !== null && /^[0-9a-f]{64}$/u.test(created) && created !== cookie && !host.identifiers.includes(created) && !made.includes(created);
    made.push(created);
    outcome.results.push(results);
    outcome.created.push(fresh ? 'new' : created);
    outcome.errors.push(first);
    host.after(made);
  }
  return outcome;
}
