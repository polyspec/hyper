// The reply of a request (HY-52, HY-103): the same cases as packages/server/php/tests/ReplyTest.php and the reply tests of
// packages/server/python/tests/test_modules.py.
import { describe, expect, it } from 'vitest';
import { Reply } from '../src/index.js';

describe('Reply', () => {
  it('accepts a Cache-Control that keeps the page private (HY-52)', () => {
    for (const value of ['private, max-age=60', 'no-store', 'Private', 'max-age=0, private', 'no-cache, no-store']) {
      expect(new Reply().cacheControl(value).cacheControlValue(), value).toBe(value);
    }
  });

  it('refuses a Cache-Control that allows a shared cache (HY-52)', () => {
    for (const value of ['public, max-age=60', 'max-age=60', 'no-cache', 'private, s-maxage=60', 'private, public', 'PUBLIC, private', 'privateer', '']) {
      expect(() => new Reply().cacheControl(value), value).toThrow();
    }
  });

  it('accepts each token of the Referrer-Policy specification (HY-103)', () => {
    for (const value of ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url']) {
      expect(new Reply().referrerPolicy(value).referrerPolicyValue(), value).toBe(value);
    }
    expect(new Reply().referrerPolicyValue()).toBeNull();
  });

  it('refuses a Referrer-Policy that is not a token (HY-103)', () => {
    for (const value of ['', 'none', 'NO-REFERRER', 'unsafe', 'origin, same-origin', 'no-referrer ']) {
      expect(() => new Reply().referrerPolicy(value), value).toThrow('Referrer-Policy');
    }
  });

  it('refuses a cookie name or value outside the rules and writes the others (HY-52)', () => {
    expect(() => new Reply().cookie('X-Session', 'v')).toThrow();
    expect(() => new Reply().cookie('session', 'a b')).toThrow();
    expect(new Reply().cookie('session', 'v', 60).cookieHeaders(true)).toEqual(['session=v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60']);
    expect(new Reply().removeCookie('session').cookieHeaders(false)).toEqual(['session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
  });
});
