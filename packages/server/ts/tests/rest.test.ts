// The rest cases of contracts/rest.json (HY-49): a rest parameter takes the rest of the path. PHP and Python pass the same
// cases. Each case is a top-level test named by its id (S6).
import { expect, it } from 'vitest';
import { routeCases, routeContract } from './support.js';

const { fixture, router } = routeContract('rest.json');

it.each(routeCases(fixture.cases))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});
