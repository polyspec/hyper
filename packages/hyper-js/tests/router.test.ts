import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Router, stripBasePath } from '../src/router.js';

interface Case {
  path: string;
  result: { name: string; params: Record<string, string> } | null;
}

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/routes.json', import.meta.url), 'utf8')) as {
  routes: { name: string; path: string }[];
  cases: Case[];
  basePath: string;
  baseCases: Case[];
  invalidPaths: string[];
};
const router = new Router(fixture.routes);

// HY-9: these are the same cases that the PHP router passes.
describe('Router conformance', () => {
  it.each(fixture.cases)('routes $path', ({ path, result }) => {
    expect(router.match(path)).toEqual(result);
  });

  it.each(fixture.baseCases)('routes $path under the base path', ({ path, result }) => {
    const stripped = stripBasePath(path, fixture.basePath);
    expect(stripped === null ? null : router.match(stripped)).toEqual(result);
  });

  it.each(fixture.invalidPaths)('rejects the route path %j', (path) => {
    expect(() => new Router([{ name: 'invalid', path }])).toThrow();
  });
});
