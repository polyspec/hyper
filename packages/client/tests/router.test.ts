import { describe, expect, it } from 'vitest';
import { Router, stripBasePath } from '../src/router.js';
import fixture from '../../../contracts/routes.json';
import rest from '../../../contracts/rest.json';

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


// HY-49: these are the same rest parameter cases that the PHP router passes.
describe('Router rest parameters', () => {
  const restRouter = new Router(rest.routes);

  it.each(rest.cases)('routes $path', ({ path, result }) => {
    expect(restRouter.match(path)).toEqual(result);
  });

  it.each(rest.invalidPaths)('rejects the route path %j', (path) => {
    expect(() => new Router([{ name: 'invalid', path }])).toThrow();
  });
});
