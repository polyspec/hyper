// The route cases of contracts/routes.json (HY-4 to HY-7): the match of a request path with the router of the browser
// package. PHP and Python pass the same cases. Each case is a top-level test named by its id (S6).
import { expect, it } from 'vitest';
import { routeCases, routeContract } from './support.js';

const { fixture, router } = routeContract('routes.json');

it.each(routeCases(fixture.cases))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});
