import { expect, it } from 'vitest';
import { Router } from '../src/router.js';
import rest from '../../../contracts/rest.json';

// HY-49: these are the same rest parameter cases that the PHP and the Node routers pass. Each case is a top-level test
// named by its id (S6).
const restRouter = new Router(rest.routes);

it.each(rest.cases.map((item) => [item.id, item] as const))('%s', (_id, { path, result }) => {
  expect(restRouter.match(path)).toEqual(result);
});

it.each(rest.invalidPaths)('rejects the route path %j', (path) => {
  expect(() => new Router([{ name: 'invalid', path }])).toThrow();
});
