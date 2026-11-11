// Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
// followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MASKED = /^[0-9a-f]{128}$/u;
const TOKEN = /^[0-9a-f]{64}$/u;

/** @internal */
export class Csrf {
  // Returns the token masked with a new random mask.
  static masked(token: string): string {
    return Csrf.mask(token, randomBytes(32).toString('hex'));
  }

  // Returns the token masked with a mask; both are 64 lowercase hexadecimal digits.
  static mask(token: string, mask: string): string {
    Csrf.requireToken(token);
    Csrf.requireToken(mask);
    return mask + Csrf.xor(Csrf.bytes(mask), Csrf.bytes(token)).toString('hex');
  }

  // Returns true when a form value is a masked value of the token, compared in constant time.
  static verify(token: string, value: string): boolean {
    Csrf.requireToken(token);
    if (!MASKED.test(value)) return false;
    return timingSafeEqual(Csrf.bytes(token), Csrf.xor(Csrf.bytes(value.slice(64)), Csrf.bytes(value.slice(0, 64))));
  }

  // Fails for a token or a mask that is not 64 lowercase hexadecimal digits (HY-24.9).
  private static requireToken(text: string): void {
    if (!TOKEN.test(text)) throw new RangeError('a CSRF token or mask is not 64 lowercase hexadecimal digits (HY-24)');
  }

  // Returns the bytes of an even number of lowercase hexadecimal digits; other text fails.
  private static bytes(hex: string): Buffer {
    if (!/^(?:[0-9a-f]{2})*$/u.test(hex)) throw new RangeError('a CSRF token or mask is not lowercase hexadecimal digits (HY-24)');
    return Buffer.from(hex, 'hex');
  }

  // Returns the bytes of the first XOR the bytes of the second, which have one length; other bytes fail.
  private static xor(first: Buffer, second: Buffer): Buffer {
    if (first.length !== second.length) throw new RangeError('the bytes of a CSRF token and its mask differ in length (HY-24)');
    return Buffer.from(first.map((byte, index) => byte ^ second.readUInt8(index)));
  }
}
