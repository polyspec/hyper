// The request that the Node host builds from the parts of node:http (HY-100).
import { describe, expect, it } from 'vitest';
import { requestOf } from '../src/host/http-host.js';

describe('Request', () => {
  it('writes the method of the host in upper case (HY-100)', () => {
    expect(requestOf({ method: 'post', target: '/' }).method).toBe('POST');
  });
});
