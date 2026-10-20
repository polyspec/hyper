// The base path cases of contracts/routes.json (HY-8): the match of a request path under a base path. PHP and Python pass
// the same cases. Each case is a top-level test named by its id (S6).
import { expect, it } from 'vitest';
import { stripBasePath } from '@polyspec/hyper-client';
import { routeCases, routeContract, text } from './support.js';

const { fixture, router } = routeContract('routes.json');

it.each(routeCases(fixture.baseCases))('%s', (_id, { path, result }) => {
  const stripped = stripBasePath(path, text(fixture.basePath));
  expect(stripped === null ? null : router.match(stripped)).toEqual(result);
});
