// The verify cases of contracts/csrf.json (HY-24): whether a form value is a masked value of a token. PHP and Python pass the
// same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { verifyToken } from '../src/csrf.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/csrf.json', import.meta.url), 'utf8')));

it.each(list(fixture.verify).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expect(verifyToken(text(item.token), text(item.value))).toBe(item.valid);
});
