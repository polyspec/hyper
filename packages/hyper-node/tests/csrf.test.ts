// The cases of conformance/csrf.json (HY-24), which PHP passes in CsrfTest.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { maskedToken, maskToken, verifyToken } from '../src/csrf.js';

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/csrf.json', import.meta.url), 'utf8')) as {
  mask: { label: string; token: string; mask: string; value: string }[];
  verify: { label: string; token: string; value: string; valid: boolean }[];
};

describe('masked session token (HY-24)', () => {
  it('masks the token with a mask', () => {
    for (const item of fixture.mask) expect(maskToken(item.token, item.mask), item.label).toBe(item.value);
  });

  it('verifies a form value', () => {
    for (const item of fixture.verify) expect(verifyToken(item.token, item.value), item.label).toBe(item.valid);
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
