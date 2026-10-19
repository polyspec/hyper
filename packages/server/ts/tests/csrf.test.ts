// The cases of contracts/csrf.json (HY-24), which PHP passes in CsrfTest. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { maskedToken, maskToken, verifyToken } from '../src/csrf.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/csrf.json', import.meta.url), 'utf8')));

it.each(list(fixture.mask).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expect(maskToken(text(item.token), text(item.mask))).toBe(item.value);
});

it.each(list(fixture.verify).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expect(verifyToken(text(item.token), text(item.value))).toBe(item.valid);
});

it('draws a new mask for every value (HY-24)', () => {
  const token = 'ab'.repeat(32);
  const a = maskedToken(token);
  const b = maskedToken(token);
  expect(a).not.toBe(b);
  expect(verifyToken(token, a)).toBe(true);
  expect(verifyToken(token, b)).toBe(true);
});
