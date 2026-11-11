import { expect, it } from 'vitest';
import { Router, stripBasePath } from '../src/router.js';
import fixture from '../../../contracts/routes.json';

const router = new Router(fixture.routes);

// HY-4, HY-5: these are the same cases that the PHP and the Node routers pass. Each case is a top-level test named by its id (S6).
it.each(fixture.cases.map((item) => [item.id, item] as const))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});

it.each(fixture.baseCases.map((item) => [item.id, item] as const))('%s', (_id, { path, result }) => {
  const stripped = stripBasePath(path, fixture.basePath);
  expect(stripped === null ? null : router.match(stripped)).toEqual(result);
});

it.each(fixture.invalidPaths)('rejects the route path $path', ({ path }) => {
  expect(() => new Router([{ name: 'invalid', path }])).toThrow();
});

// HY-5: the parameters of a match are a map from each parameter name to its value, so a name such as __proto__ keeps
// its value (the rest parameter too).
it('keeps a parameter named __proto__', () => {
  const named = new Router([{ name: 'named', path: '/x/{__proto__}' }]);
  expect(named.match('/x/abc')?.params.__proto__).toBe('abc');
  const rest = new Router([{ name: 'rest', path: '/x/{__proto__*}' }]);
  expect(rest.match('/x/a/b')?.params.__proto__).toBe('/a/b');
});
