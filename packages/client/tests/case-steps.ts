// The steps of the browser runner (HYR-7) for the case files context.json, keep.json, reads.json, routes.json and rest.json. Each step
// calls the browser package, and reads its cases through the case reader of the server tree (the only import from there).
import { parse } from '@polyspec/template';
import { MapLoader, resolvePath, type MapValue, type Value } from '@polyspec/template/render';
import type { CaseReader } from '../../server/ts/tests/case-reader.js';
import { applyKept, copyValue, createEngine, keepRead, Router, stripBasePath, templateReads, withContext } from '../src/index.js';

export type Step = (reader: CaseReader) => unknown;

// Returns the map of a value of the case data, or throws for a value that is not a map.
function requireMap(value: Value, label: string): MapValue {
  if (!(value instanceof Map)) throw new TypeError(`hyper: ${label} is not a map`);
  return value;
}

// Returns the kept values that conform to the data, by path, applying each one before the next (HY-38). The pairs are
// applied to a copy of the data, so a value that does not conform is not selected.
function selectKept(data: MapValue, pairs: [string, Value][]): MapValue {
  const applied = requireMap(copyValue(data), 'the region data');
  const selected: MapValue = new Map();
  for (const [path, value] of pairs) {
    if (applyKept(applied, [[path, value]]).length > 0) selected.set(path, value);
  }
  return selected;
}

// Returns the router of the routes that a case file declares.
function routerOf(routes: unknown): Router {
  return new Router((routes as Map<string, string>[]).map((route) => ({ name: route.get('name') as string, path: route.get('path') as string })));
}

// Refuses a route path that a router must reject; the case states the error that the router raised, or null.
function refusesPath(reader: CaseReader): void {
  const path = reader.input('path') as string;
  let error: unknown = null;
  try {
    new Router([{ name: 'invalid', path }]);
  } catch (caught) {
    error = caught;
  }
  reader.outcome('router', error);
}

// The cases step of contracts/keep.json (HY-38): the kept values that conform, applied to the data, give the expected data.
function keepCases(reader: CaseReader): void {
  const data = requireMap(reader.input('data') as Value, 'data');
  const kept = (reader.input('kept') as Value[]).map((entry): [string, Value] => {
    const [path, value] = entry as Value[];
    return [path as string, value as Value];
  });
  const applied = requireMap(copyValue(data), 'data');
  applyKept(applied, [...selectKept(data, kept)]);
  reader.compare('expected', applied);
}

// The cases step of contracts/reads.json (HY-73): the read paths of the templates, and the kept data renders as the full
// data does.
function readsCases(reader: CaseReader): void {
  const sources = reader.input('templates') as Map<string, string>;
  const templates = new Map([...sources].map(([name, source]) => [name, parse(source, name)] as const));
  const template = reader.input('template') as string;
  const reads = templateReads((name) => {
    const found = templates.get(name);
    if (found === undefined) throw new Error(`the template ${name} is missing`);
    return found;
  }, resolvePath, template);
  reader.compare('reads', reads);

  const data = reader.input('data') as Value;
  const kept = keepRead(data, reads);
  reader.compare('kept', kept);

  const loader = new MapLoader();
  for (const [name, source] of templates) loader.set(name, source);
  const engine = createEngine(loader);
  const whole = engine.render(template, data);
  reader.outcome('render', [engine.render(template, kept), whole]);
  // HY-13.1: the template rendered alone with its data.
  if (reader.has('text')) reader.compare('text', whole);
}

// The steps of contracts/routes.json (HY-4 to HY-8) and contracts/rest.json (HY-49): the match of a request path.
const routes = {
  cases(reader: CaseReader): void {
    reader.compare('result', routerOf(reader.input('routes')).match(reader.input('path') as string));
  },
  baseCases(reader: CaseReader): void {
    const router = routerOf(reader.input('routes'));
    const stripped = stripBasePath(reader.input('path') as string, reader.input('basePath') as string);
    reader.compare('result', stripped === null ? null : router.match(stripped));
  },
  invalidPaths: refusesPath,
};

// The step of the section withContext of contracts/context.json (HY-10, HY-128): the place of the context that a JSON
// response carries in the shared data that the browser renders.
function placesContext(reader: CaseReader): void {
  const names = reader.input('shared');
  if (!Array.isArray(names) || !names.every((name): name is string => typeof name === 'string')) throw new TypeError('hyper: the case field shared is not a list of strings');
  const shared: MapValue = new Map(names.map((name) => [name, name]));
  let keys: string[] | null = null;
  let context: Value | null = null;
  let fails = false;
  try {
    const placed = withContext(shared, new Map<string, Value>([['name', 'Board']]));
    keys = [...placed.keys()];
    context = placed.get('context') ?? null;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already holds the member context')) throw error;
    fails = true;
  }
  reader.compare('keys', keys);
  reader.compare('context', context);
  reader.compare('fails', fails);
}

// The browser steps by case file and section (`file:section`). A section without a step fails its cases.
export const STEPS: Record<string, Step> = {
  'context.json:withContext': placesContext,
  'keep.json:cases': keepCases,
  'reads.json:cases': readsCases,
  'routes.json:cases': routes.cases,
  'routes.json:baseCases': routes.baseCases,
  'routes.json:invalidPaths': routes.invalidPaths,
  'rest.json:cases': routes.cases,
  'rest.json:invalidPaths': routes.invalidPaths,
};
