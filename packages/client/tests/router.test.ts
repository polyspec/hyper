import { expect, it } from 'vitest';
import { Router, stripBasePath } from '../src/router.js';
import fixture from '../../../contracts/routes.json';

const router = new Router(fixture.routes);

// HY-9: these are the same cases that the PHP and the Node routers pass. Each case is a top-level test named by its id (S6).
it.each(fixture.cases.map((item) => [item.id, item] as const))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});

it.each(fixture.baseCases.map((item) => [item.id, item] as const))('%s', (_id, { path, result }) => {
  const stripped = stripBasePath(path, fixture.basePath);
  expect(stripped === null ? null : router.match(stripped)).toEqual(result);
});

it.each(fixture.invalidPaths)('rejects the route path %j', (path) => {
  expect(() => new Router([{ name: 'invalid', path }])).toThrow();
});
