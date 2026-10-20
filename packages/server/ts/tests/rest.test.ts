// The rest cases of packages/server/php/tests/RouterTest.php: the server routes with the router of the browser
// package (HY-9, HY-49). Each case of contracts/rest.json is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Router } from '@polyspec/hyper-client';
import { list, parsed, record, text } from './support.js';

interface Case {
  id: string;
  path: string;
  result: unknown;
}

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/rest.json', import.meta.url), 'utf8')));
const cases = (value: unknown): [string, Case][] => list(value).map(record).map((item) => [text(item.id), { id: text(item.id), path: text(item.path), result: item.result }]);
const router = new Router(list(fixture.routes).map(record).map((route) => ({ name: text(route.name), path: text(route.path) })));

it.each(cases(fixture.cases))('%s', (_id, { path, result }) => {
  expect(router.match(path)).toEqual(result);
});

it.each(list(fixture.invalidPaths).map(text))('rejects the route path %j', (path) => {
  expect(() => new Router([{ name: 'invalid', path }])).toThrow();
});
