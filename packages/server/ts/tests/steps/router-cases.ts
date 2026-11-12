// The steps of contracts/routes.json (HY-4 to HY-8) and contracts/rest.json (HY-49): the match of a request path with
// a router. The Node step gives the router of the built browser package, and the browser step that of its source.
import type { CaseReader } from '../case-reader.ts';
import { mapsOf, textOf } from '../inputs.ts';

type RouterClass = new (routes: { name: string; path: string }[]) => { match(path: string): unknown };

// Returns the three steps of a router: the match of a path, the match after the base path is removed, and the refusal
// of a route path.
export function routerSteps(api: { Router: RouterClass; stripBasePath: (path: string, basePath: string) => string | null }): {
  cases: (reader: CaseReader) => void;
  baseCases: (reader: CaseReader) => void;
  invalidPaths: (reader: CaseReader) => void;
} {
  // Returns the router of the routes that a case file declares.
  const routerOf = (routes: unknown): { match(path: string): unknown } =>
    new api.Router(mapsOf(routes, 'routes').map((route) => ({ name: textOf(route.get('name'), 'the name of a route'), path: textOf(route.get('path'), 'the path of a route') })));
  return {
    cases: (reader) => {
      reader.compare('result', routerOf(reader.input('routes')).match(textOf(reader.input('path'), 'path')));
    },
    baseCases: (reader) => {
      const router = routerOf(reader.input('routes'));
      const stripped = api.stripBasePath(textOf(reader.input('path'), 'path'), textOf(reader.input('basePath'), 'basePath'));
      reader.compare('result', stripped === null ? null : router.match(stripped));
    },
    // Refuses a route path that a router must reject; the case states the error that the router raised, or null.
    invalidPaths: (reader) => {
      const path = textOf(reader.input('path'), 'path');
      let error: unknown = null;
      try {
        new api.Router([{ name: 'invalid', path }]);
      } catch (caught) {
        error = caught;
      }
      reader.outcome('router', error);
    },
  };
}
