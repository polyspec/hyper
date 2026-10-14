// The cases of contracts/csrf.json (HY-24), which PHP passes in CsrfTest.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { maskedToken, maskToken, verifyToken } from '../src/csrf.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/csrf.json', import.meta.url), 'utf8')));

describe('masked session token (HY-24)', () => {
  it('masks the token with a mask', () => {
    for (const item of list(fixture.mask).map(record)) expect(maskToken(text(item.token), text(item.mask)), text(item.label)).toBe(item.value);
  });

  it('verifies a form value', () => {
    for (const item of list(fixture.verify).map(record)) expect(verifyToken(text(item.token), text(item.value)), text(item.label)).toBe(item.valid);
  });

  it('draws a new mask for every value', () => {
    const token = 'ab'.repeat(32);
    const a = maskedToken(token);
    const b = maskedToken(token);
    expect(a).not.toBe(b);
    expect(verifyToken(token, a)).toBe(true);
    expect(verifyToken(token, b)).toBe(true);
  });
});
