// The hyper JSON media type is compared without regard to case and parameters (HY-15, RFC 9110 section 8.3.1).
import { describe, expect, it } from 'vitest';
import { isHyperJson } from '../src/media-type.js';

describe('isHyperJson (HY-15)', () => {
  it.each([
    'application/vnd.hyper+json',
    'application/vnd.hyper+json; charset=utf-8',
    'Application/Vnd.Hyper+JSON',
    ' application/vnd.hyper+json ; x=1',
  ])('accepts %j', (contentType) => {
    expect(isHyperJson(contentType)).toBe(true);
  });

  it.each([
    'application/vnd.hyper+jsonx',
    'application/json',
    'text/html',
    '',
  ])('rejects %j', (contentType) => {
    expect(isHyperJson(contentType)).toBe(false);
  });

  it('rejects a missing Content-Type (null)', () => {
    expect(isHyperJson(null)).toBe(false);
  });
});
