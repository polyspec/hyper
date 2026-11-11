// The representations of a route: the declaration of each entry and its manifest check (HY-2, HY-118), and the check of
// the representation handlers that an application provides at open (HY-118).

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// The characters of a quoted string and of a quoted pair that a manifest value may hold without quoting (RFC 9110,
// section 5.6.4), so a value written unquoted in a Content-Type is valid as a quoted string.
const QUOTABLE = /^[\t \x21-\x7e\x80-\xff]+$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const PAGE_TYPES = ['text/html', 'application/vnd.hyper+json'];
const REJECTED_VARY = ['accept', 'cookie'];

// One declared representation of a route (HY-118): its type as the manifest writes it, its lower-case media type, its
// required parameters, each a lower-case name with its served values, in declared order, its methods and its vary names.
/** @internal */
export interface Entry {
  readonly type: string;
  readonly media: string;
  readonly parameters: readonly (readonly [string, readonly string[]])[];
  readonly methods: readonly string[];
  readonly vary: readonly string[];
}

/** @internal */
export class RepresentationEntries {
  // Returns the entries of a route in the order of the manifest, checked by HY-2 and HY-118: a duplicate type, a page
  // type, a wildcard, an invalid type, parameter or value, an empty method or value list, and an invalid vary name fail
  // the manifest. `raw` is the value of `representations` of the route, decoded with maps for objects, or undefined.
  static declare(route: string, raw: unknown): Entry[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('hyper: manifest representations is not a list');
    const entries: Entry[] = [];
    const mediaTypes = new Set<string>();
    for (const item of raw) {
      if (!(item instanceof Map)) throw new Error('hyper: manifest representations contains a value that is not an object');
      const entry = RepresentationEntries.entry(route, item);
      if (mediaTypes.has(entry.media)) throw new Error(`hyper: route ${route} declares the type ${entry.type} twice (HY-118)`);
      mediaTypes.add(entry.media);
      entries.push(entry);
    }
    return entries;
  }

  // Fails the open when an entry has no handler or a handler is keyed by a type that the route does not declare; the
  // keys compare exactly as the manifest writes them (HY-118).
  static checkHandlers(route: string, entries: readonly Entry[], handlers: Record<string, unknown>): void {
    const declared = entries.map((entry) => entry.type);
    for (const type of declared) {
      if (!Object.hasOwn(handlers, type)) throw new Error(`hyper: route ${route} has no representation handler for ${type} (HY-118)`);
    }
    for (const type of Object.keys(handlers)) {
      if (!declared.includes(type)) throw new Error(`hyper: route ${route} has a representation handler for ${type}, which the route does not declare (HY-118)`);
    }
  }

  private static entry(route: string, item: Map<unknown, unknown>): Entry {
    for (const key of ['type', 'parameters', 'methods', 'vary']) {
      if (!item.has(key)) throw new Error(`hyper: route ${route} has a representation without ${key} (HY-118)`);
    }
    const kind: unknown = item.get('type');
    if (typeof kind !== 'string') throw new Error(`hyper: route ${route} has a representation type that is not text (HY-118)`);
    const slash = kind.indexOf('/');
    const main = kind.slice(0, Math.max(slash, 0));
    const sub = kind.slice(slash + 1);
    // The type and the subtype are tokens as the manifest writes them, so that lower case changes only ASCII letters.
    if (slash < 0 || !TOKEN.test(main) || !TOKEN.test(sub) || main === '*' || sub === '*' || PAGE_TYPES.includes(kind.toLowerCase())) {
      throw new Error(`hyper: route ${route} has the invalid representation type ${kind} (HY-118)`);
    }
    return {
      type: kind,
      media: kind.toLowerCase(),
      parameters: RepresentationEntries.parameters(route, kind, item.get('parameters')),
      methods: RepresentationEntries.methods(route, kind, item.get('methods')),
      vary: RepresentationEntries.vary(route, kind, item.get('vary')),
    };
  }

  private static parameters(route: string, kind: string, raw: unknown): [string, string[]][] {
    if (!(raw instanceof Map)) throw new Error(`hyper: route ${route} has parameters of ${kind} that are not an object (HY-118)`);
    const parameters: [string, string[]][] = [];
    const names = new Set<string>();
    const declared: Map<unknown, unknown> = raw;
    for (const [name, values] of declared) {
      if (typeof name !== 'string') throw new Error(`hyper: route ${route} has a parameter name of ${kind} that is not text (HY-118)`);
      const lower = name.toLowerCase();
      if (!TOKEN.test(name) || lower === 'q' || names.has(lower)) throw new Error(`hyper: route ${route} has the invalid parameter ${name} of ${kind} (HY-118)`);
      names.add(lower);
      if (!Array.isArray(values) || values.length === 0) throw new Error(`hyper: route ${route} has no served value for ${name} of ${kind} (HY-118)`);
      const served: string[] = [];
      const given: unknown[] = values;
      for (const value of given) {
        if (typeof value !== 'string' || (!TOKEN.test(value) && !QUOTABLE.test(value))) throw new Error(`hyper: route ${route} has the invalid value of ${name} of ${kind} (HY-118)`);
        served.push(value);
      }
      parameters.push([lower, served]);
    }
    return parameters;
  }

  private static methods(route: string, kind: string, raw: unknown): string[] {
    const given: unknown[] = Array.isArray(raw) ? raw : [];
    const methods: string[] = [];
    for (const method of given) {
      if (typeof method === 'string' && METHODS.includes(method)) methods.push(method);
    }
    if (methods.length === 0 || methods.length !== given.length) {
      throw new Error(`hyper: route ${route} has methods of ${kind} that are not a nonempty subset of GET, POST, PUT, DELETE (HY-118)`);
    }
    return methods;
  }

  private static vary(route: string, kind: string, raw: unknown): string[] {
    if (!Array.isArray(raw)) throw new Error(`hyper: route ${route} has vary names of ${kind} that are not a list (HY-118)`);
    const names: string[] = [];
    const given: unknown[] = raw;
    for (const name of given) {
      if (typeof name !== 'string' || !TOKEN.test(name)) throw new Error(`hyper: route ${route} has the vary name ${String(name)} of ${kind} that is not a field name (HY-118)`);
      if (REJECTED_VARY.includes(name.toLowerCase()) || names.some((other) => other.toLowerCase() === name.toLowerCase())) {
        throw new Error(`hyper: route ${route} has the vary name ${name} of ${kind} that is rejected or repeated (HY-118)`);
      }
      names.push(name);
    }
    return names;
  }
}
