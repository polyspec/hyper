// Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
// followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MASKED = /^[0-9a-f]{128}$/u;

/** @internal */
export class Csrf {
  // Returns the token masked with a new random mask.
  static masked(token: string): string {
    return Csrf.mask(token, randomBytes(32).toString('hex'));
  }

  // Returns the token masked with a mask; both are 64 lowercase hexadecimal digits.
  static mask(token: string, mask: string): string {
    return mask + Csrf.xor(Csrf.bytes(mask), Csrf.bytes(token)).toString('hex');
  }

  // Returns true when a form value is a masked value of the token, compared in constant time.
  static verify(token: string, value: string): boolean {
    if (!MASKED.test(value)) return false;
    return timingSafeEqual(Csrf.bytes(token), Csrf.xor(Csrf.bytes(value.slice(64)), Csrf.bytes(value.slice(0, 64))));
  }

  // Returns the bytes of an even number of hexadecimal digits; other text fails.
  private static bytes(hex: string): Buffer {
    if (!/^(?:[0-9a-fA-F]{2})*$/u.test(hex)) throw new RangeError('a CSRF token or mask is not hexadecimal digits');
    return Buffer.from(hex, 'hex');
  }

  // Returns the bytes of the first XOR the bytes of the second, as long as the shorter.
  private static xor(first: Buffer, second: Buffer): Buffer {
    const length = Math.min(first.length, second.length);
    const out = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) out[index] = (first[index] ?? 0) ^ (second[index] ?? 0);
    return out;
  }
}
