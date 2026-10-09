// The cases of packages/hyper-server-php/tests/ResultTest.php (HY-46). A PHP string that is not UTF-8 corresponds to a
// JavaScript string with a lone surrogate.
import { describe, expect, it } from 'vitest';
import { Redirect, Result } from '../src/index.js';

const rejected = ['', 'board', '//evil.example', '/\\evil.example', '/\t/evil.example', '/ok\r\nX-Injected: 1', '/a b', '/a\x00', '/a\u0085', '/a\uD800', '/a\\b', '/.//evil.example', '/a/..//evil.example', '/%2E//evil.example', '/a/%2e%2E/b', '/a/.', '/./b?x=1'];

describe('Result', () => {
  it.each(rejected)('rejects the location %j outside the application', (location) => {
    expect(() => Result.redirect(location)).toThrow('not an application path');
  });

  it('accepts application paths', () => {
    expect(Result.redirect('/board?page=2').location).toBe('/board?page=2');
    expect(Result.redirect('/').location).toBe('/');
    expect(Result.redirect('/a.b/..c/.d?x=..').location).toBe('/a.b/..c/.d?x=..');
  });

  it('requires a redirect result for Redirect (HY-50)', () => {
    expect(() => new Redirect(Result.invalid({}))).toThrow('redirect result');
  });
});
