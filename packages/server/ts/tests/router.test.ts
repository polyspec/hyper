// The router cases of packages/server/php/tests/RouterTest.php: the server routes with the router of the browser
// package (HY-9, HY-49). Each case of contracts/routes.json is a top-level test named by its id (S6).
import { expect, it } from 'vitest';
import { Router, stripBasePath } from '@polyspec/hyper-client';
import { list, routeCases, routeContract, text } from './support.js';

const { fixture, router } = routeContract('routes.json');

it.each(routeCases(fixture.cases))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});

it.each(routeCases(fixture.baseCases))('%s', (_id, { path, result }) => {
  const stripped = stripBasePath(path, text(fixture.basePath));
  expect(stripped === null ? null : router.match(stripped)).toEqual(result);
});

it.each(list(fixture.invalidPaths).map(text))('rejects the route path %j', (path) => {
  expect(() => new Router([{ name: 'invalid', path }])).toThrow();
});
