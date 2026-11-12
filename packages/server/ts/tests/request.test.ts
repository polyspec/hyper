// The cases of packages/server/php/tests/RequestTest.php (HY-42, HY-45).
import { describe, expect, it } from 'vitest';
import { requestOf } from '../src/http-host.js';

const targets: [string, string, string][] = [
  ['colon', '/board/12:30', '/board/12:30'],
  ['colon and query', '/t/x:0/y?x=1', '/t/x:0/y'],
  ['double slash', '//board/1', '//board/1'],
  ['fragment', '/board#top', '/board'],
  ['root', '/', '/'],
  ['encoded', '/board/%ED%95%9C?q=1', '/board/%ED%95%9C'],
  ['leading question mark', '?/board', '/'],
  ['absolute form', 'http://example.test/board/1?x=1', '/board/1'],
  ['absolute form without path', 'https://example.test', '/'],
];

describe('Request', () => {
  it.each(targets)('takes the path of the request target before the query: %s (HY-42)', (_label, target, path) => {
    expect(requestOf({ method: 'GET', target }).path()).toBe(path);
  });

  it('writes the method of the host in upper case (HY-100)', () => {
    expect(requestOf({ method: 'post', target: '/' }).method).toBe('POST');
  });
});
