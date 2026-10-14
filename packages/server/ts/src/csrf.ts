// Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
// followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token.
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MASKED = /^[0-9a-f]{128}$/;

// Returns the token masked with a mask; both are 64 lowercase hexadecimal digits.
export function maskToken(token: string, mask: string): string {
  const key = Buffer.from(mask, 'hex');
  const value = Buffer.from(token, 'hex');
  return mask + Buffer.from(key.map((byte, index) => byte ^ value[index]!)).toString('hex');
}

// Returns the token masked with a new random mask.
export function maskedToken(token: string): string {
  return maskToken(token, randomBytes(32).toString('hex'));
}

// Returns true when a form value is a masked value of the token, compared in constant time.
export function verifyToken(token: string, value: string): boolean {
  if (!MASKED.test(value)) return false;
  const mask = Buffer.from(value.slice(0, 64), 'hex');
  const unmasked = Buffer.from(Buffer.from(value.slice(64), 'hex').map((byte, index) => byte ^ mask[index]!));
  return timingSafeEqual(unmasked, Buffer.from(token, 'hex'));
}
