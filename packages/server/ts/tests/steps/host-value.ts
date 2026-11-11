// The host value of a decoded value of a case, which the steps hand to the server (HY-44).
import { OutsideNumber } from '../../src/outside-number.js';

// Returns a decoded JSON value as the host value that a handler of a case returns: an integer outside ±(2^53 − 1) is a
// bigint, as PHP and Python decode it to their integer, so that the three servers check the same value (HY-44). A number
// with a fraction or an exponent outside that range has no host value of the case and fails.
export function hostValue(value: unknown): unknown {
  if (value instanceof OutsideNumber) {
    if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value.literal)) throw new Error(`the case number ${value.literal} is not an integer`);
    return BigInt(value.literal);
  }
  if (Array.isArray(value)) return value.map((item: unknown) => hostValue(item));
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, hostValue(item)]));
  return value;
}
