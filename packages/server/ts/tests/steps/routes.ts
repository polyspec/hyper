// The steps of contracts/routes.json (HY-4 to HY-8): the match of a request path with the router of the browser package.
import { Router, stripBasePath } from '@polyspec/hyper-client';
import type { CaseReader } from '../case-reader.js';

// Returns the router of the routes that a case file declares.
export function routerOf(routes: unknown): Router {
  return new Router((routes as Map<string, string>[]).map((route) => ({ name: route.get('name') as string, path: route.get('path') as string })));
}

// Refuses a route path that a router must reject; the case states whether the router raised.
export function refusesPath(reader: CaseReader): void {
  const path = reader.input('path') as string;
  let raised = false;
  try {
    new Router([{ name: 'invalid', path }]);
  } catch {
    raised = true;
  }
  reader.outcome('router', raised);
}

export const steps = {
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
