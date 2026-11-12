// The steps of the browser runner (HYR-7) for the case files app.json, context.json, keep.json, reads.json, routes.json
// and rest.json. Each step calls the browser package. It reads its cases through the case reader of the server test tree,
// and the steps that the Node runner has too come from the shared steps of that tree, which take the functions of the
// browser package as arguments.
import { parse } from '@polyspec/template';
import type { MapValue, Value } from '@polyspec/template/render';
import type { CaseReader } from '../../server/ts/tests/case-reader.js';
import type { Step } from '../../server/ts/tests/case-run.js';
import { listOf, textOf } from '../../server/ts/tests/inputs.js';
import { placesContext } from '../../server/ts/tests/steps/context-place.js';
import { comparesParts } from '../../server/ts/tests/steps/parts-cases.js';
import { readsCases } from '../../server/ts/tests/steps/reads-cases.js';
import { routerSteps } from '../../server/ts/tests/steps/router-cases.js';
import { applyKept, checkManifest, copyValue, createApplication, createEngine, decodeResponse, keepRead, renderDocument, renderParts, Router, stripBasePath, templateReads, withContext } from '../src/index.js';
import { isValue } from './values.js';

// Returns the map of a value of the case data, or throws for a value that is not a map.
function requireMap(value: Value, label: string): MapValue {
  if (!(value instanceof Map)) throw new TypeError(`hyper: ${label} is not a map`);
  return value;
}

// Returns the map of an input of a case as a template value, which the reader gives for a JSON object, or throws.
function inputMap(value: unknown, what: string): MapValue {
  if (!(value instanceof Map) || !isValue(value)) throw new TypeError(`hyper: ${what} is not an object of the case file`);
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

// The cases step of contracts/keep.json (HY-38): the kept values that conform, applied to the data, give the expected
// data. The Node step applies them with the kept values of the server, another code path, so this step is the browser's.
function keepCases(reader: CaseReader): void {
  const data = inputMap(reader.input('data'), 'data');
  const kept = listOf(reader.input('kept'), 'kept').map((entry): [string, Value] => {
    const [path, value] = listOf(entry, 'a kept pair');
    if (!isValue(value)) throw new TypeError('hyper: the value of a kept pair of the case is not a template value');
    return [textOf(path, 'the path of a kept pair'), value];
  });
  const applied = requireMap(copyValue(data), 'data');
  applyKept(applied, [...selectKept(data, kept)]);
  reader.compare('expected', applied);
}

// Returns the JSON value of a value of a case, whose objects the reader gives as maps.
function plain(value: Value): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
  return Array.isArray(value) ? value.map(plain) : value;
}

// The step of the section parts of contracts/app.json (HY-12, HY-13): the title and the regions of a route rendered
// alone by the source of the browser package, compared with their places in the document and in the page region.
async function partsCases(reader: CaseReader): Promise<void> {
  const name = textOf(reader.input('application'), 'application');
  const application = inputMap(inputMap(reader.input('applications'), 'applications').get(name), `the application ${name}`);
  const sources = inputMap(application.get('templates'), 'templates');
  const names = [...sources.keys()];
  const manifest = checkManifest(plain(inputMap(application.get('manifest'), 'manifest')));
  const app = createApplication(manifest, Object.fromEntries(names.map((template) => [template, { url: template }])), async (url) => parse(textOf(sources.get(url), `the template ${url}`), url));
  await app.templates.ensure(names);

  const routeName = textOf(reader.input('route'), 'route');
  const route = manifest.routes.find((declared) => declared.name === routeName);
  if (route === undefined) throw new Error(`hyper: the manifest has no route ${routeName}`);
  if (route.path.includes('{')) throw new Error(`hyper: the path ${route.path} of the route ${routeName} has a parameter`);
  const regions = inputMap(reader.input('regions'), 'regions');
  const value: MapValue = new Map<string, Value>([
    ['env', new Map([['timezone', application.get('timezone') ?? '+09:00']])],
    ['route', routeName],
    ['params', new Map()],
    ['build', textOf(application.get('build'), 'build')],
    ['shared', inputMap(reader.input('shared'), 'shared')],
    ['regions', regions],
    ['kept', new Map()],
  ]);
  const rendered = renderParts(app, decodeResponse(app, value, route.path));
  // A second decode, because a decoded response holds copies that a rendering may change.
  const document = renderDocument(app, decodeResponse(app, value, route.path), { embed: false });
  comparesParts(reader, rendered, document, manifest, route, regions);
}

// The steps of contracts/routes.json (HY-4 to HY-8) and contracts/rest.json (HY-49) with the router of the source.
const routes = routerSteps({ Router, stripBasePath });

// The browser steps by case file and section (`file:section`). A section without a step fails its cases.
export const STEPS: Record<string, Step> = {
  'app.json:parts': partsCases,
  'context.json:withContext': (reader) => placesContext(reader, withContext),
  'keep.json:cases': keepCases,
  'reads.json:cases': (reader) => readsCases(reader, { templateReads, keepRead, createEngine }),
  'routes.json:cases': routes.cases,
  'routes.json:baseCases': routes.baseCases,
  'routes.json:invalidPaths': routes.invalidPaths,
  'rest.json:cases': routes.cases,
  'rest.json:invalidPaths': routes.invalidPaths,
};
