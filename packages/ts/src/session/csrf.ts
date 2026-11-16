// Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
// followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token. The core
// states each rule (HY-132.2); this class draws the random mask.
import { randomBytes } from 'node:crypto';
import { rules } from '../app/core-rules.js';

/** @internal */
export class Csrf {
  // Returns the token masked with a new random mask.
  static masked(token: string): string {
    return Csrf.mask(token, randomBytes(32).toString('hex'));
  }

  // Returns the token masked with a mask; both are 64 lowercase hexadecimal digits (HY-24.2).
  static mask(token: string, mask: string): string {
    return rules().csrfMask(token, mask);
  }

  // Returns true when a form value is a masked value of the token, compared in constant time (HY-24.4).
  static verify(token: string, value: string): boolean {
    return rules().csrfVerify(token, value);
  }

  // Returns the SHA-256 digest, as 64 lowercase hexadecimal digits, of the token that a masked value holds, or null
  // for the empty text, which a request without a session holds (HY-24.10, HY-24.12).
  static browserOf(masked: string): string | null {
    return rules().csrfBrowserOf(masked);
  }
}
