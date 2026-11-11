// The parse cases of contracts/cookies.json (HY-129). A header is text whose characters U+0000 to U+00FF are its bytes,
// and null is a request without the header. Each case is a top-level test named by its id.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from '../src/cookies.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/cookies.json', import.meta.url), 'utf8')));
const cases = list(fixture.parse).map(record);

it('finds the cases of contracts/cookies.json', () => {
  expect(cases.length).toBeGreaterThan(0);
});

it.each(cases.map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  const header = item.header === null ? undefined : text(item.header);
  const expected = Object.fromEntries(Object.entries(record(item.cookies)).map(([name, value]) => [name, text(value)]));
  expect(Object.fromEntries(parse(header))).toStrictEqual(expected);
});
