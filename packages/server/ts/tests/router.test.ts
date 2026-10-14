// The router cases of packages/server/php/tests/RouterTest.php: the server routes with the router of the browser
// package (HY-9, HY-49).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Router, stripBasePath } from '@polyspec/hyper-client';
import { list, parsed, record, text } from './support.js';

interface Case {
  path: string;
  result: unknown;
}

const read = (name: string) => record(parsed(readFileSync(new URL(`../../../../contracts/${name}`, import.meta.url), 'utf8')));
const cases = (value: unknown): Case[] => list(value).map(record).map((item) => ({ path: text(item.path), result: item.result }));

describe.each(['routes.json', 'rest.json'])('router conformance of %s', (name) => {
  const fixture = read(name);
  const router = new Router(list(fixture.routes).map(record).map((route) => ({ name: text(route.name), path: text(route.path) })));

  it.each(cases(fixture.cases))('routes $path', ({ path, result }) => {
    expect(router.match(path)).toEqual(result);
  });

  it.each(fixture.baseCases === undefined ? [] : cases(fixture.baseCases))('routes $path under the base path', ({ path, result }) => {
    const stripped = stripBasePath(path, text(fixture.basePath));
    expect(stripped === null ? null : router.match(stripped)).toEqual(result);
  });

  it.each(list(fixture.invalidPaths).map(text))('rejects the route path %j', (path) => {
    expect(() => new Router([{ name: 'invalid', path }])).toThrow();
  });
});
