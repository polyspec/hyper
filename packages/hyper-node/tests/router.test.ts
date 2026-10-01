// The router cases of packages/hyper-php/tests/RouterTest.php: the server routes with the router of the browser
// package (HY-9, HY-49).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Router, stripBasePath } from '@polyspec/hyper';

interface Case {
  path: string;
  result: { name: string; params: Record<string, string> } | null;
}

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../conformance/${name}`, import.meta.url), 'utf8')) as {
  routes: { name: string; path: string }[];
  cases: Case[];
  basePath?: string;
  baseCases?: Case[];
  invalidPaths: string[];
};

describe.each(['routes.json', 'rest.json'])('router conformance of %s', (name) => {
  const fixture = read(name);
  const router = new Router(fixture.routes);

  it.each(fixture.cases)('routes $path', ({ path, result }) => {
    expect(router.match(path)).toEqual(result);
  });

  it.each(fixture.baseCases ?? [])('routes $path under the base path', ({ path, result }) => {
    const stripped = stripBasePath(path, fixture.basePath!);
    expect(stripped === null ? null : router.match(stripped)).toEqual(result);
  });

  it.each(fixture.invalidPaths)('rejects the route path %j', (path) => {
    expect(() => new Router([{ name: 'invalid', path }])).toThrow();
  });
});
