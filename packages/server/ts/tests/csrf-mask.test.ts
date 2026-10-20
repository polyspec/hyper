// The mask cases of contracts/csrf.json (HY-24): the value of a token with a mask. PHP and Python pass the same cases. Each
// case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { maskToken } from '../src/csrf.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/csrf.json', import.meta.url), 'utf8')));

it.each(list(fixture.mask).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expect(maskToken(text(item.token), text(item.mask))).toBe(item.value);
});
