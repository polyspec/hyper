// The masked session token beyond the cases of contracts/csrf.json (HY-24).
import { expect, it } from 'vitest';
import { maskedToken, verifyToken } from '../src/csrf.js';

it('draws a new mask for every value (HY-24)', () => {
  const token = 'ab'.repeat(32);
  const a = maskedToken(token);
  const b = maskedToken(token);
  expect(a).not.toBe(b);
  expect(verifyToken(token, a)).toBe(true);
  expect(verifyToken(token, b)).toBe(true);
});
