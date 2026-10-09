// The cases of packages/hyper-server-php/tests/RequestTest.php (HY-42, HY-45).
import { describe, expect, it } from 'vitest';
import { Request } from '../src/index.js';

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
    expect(Request.from({ method: 'GET', target }).path()).toBe(path);
  });

  it('rejects names and values that are not UTF-8 (HY-42)', () => {
    expect(Request.from({ method: 'GET', target: '/?a[%FF][x]=1' }).validInput()).toBe(false);
    expect(Request.from({ method: 'GET', target: '/?a%FF[x]=1' }).validInput()).toBe(false);
    const form = (body: string) => Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: Buffer.from(body, 'latin1') });
    expect(form('a[b][%C3]=v').validInput()).toBe(false);
    expect(form('a=%E2%82').validInput()).toBe(false);
    expect(Request.from({ method: 'GET', target: '/?a[b][c]=d' }).validInput()).toBe(true);
  });

  it('does not check cookies (HY-42)', () => {
    const request = Request.from({ method: 'GET', target: '/', headers: { Cookie: 'hy-keep=%FF; hy-session=%FF' } });
    expect(request.validInput()).toBe(true);
    expect(request.cookie('hy-keep')).toBeNull();
  });

  it('reads form fields, query values and cookies as PHP does', () => {
    const request = Request.from({
      method: 'post',
      target: '/?page=2&page=3&n=1234567890123456&q=a+b%20c',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: 'a=1; b=%7B%22x%22%3A1%7D; a=2' },
      body: Buffer.from('title=%ED%95%9C+%EA%B8%80&empty&x=1&x=2'),
    });
    expect(request.method).toBe('POST');
    expect(request.queryInt('page', 1)).toBe(3);
    expect(request.queryInt('n', 7)).toBe(7);
    expect(request.queryInt('q', 7)).toBe(7);
    expect(request.formString('title')).toBe('한 글');
    expect(request.formString('empty')).toBe('');
    expect(request.formString('x')).toBe('2');
    expect(request.formString('missing')).toBe('');
    expect(request.cookie('a')).toBe('1');
    expect(request.cookie('b')).toBe('{"x":1}');
  });

  it('reads every query value in order without nesting and the raw query (HY-56)', () => {
    const request = Request.from({ method: 'GET', target: '/board?b=1&roles[]=a&roles%5B%5D=b&1=x&b=2&q=a+b#top' });
    expect(request.rawQuery()).toBe('b=1&roles[]=a&roles%5B%5D=b&1=x&b=2&q=a+b');
    expect([...request.query()]).toEqual([['b', ['1', '2']], ['roles[]', ['a', 'b']], ['1', ['x']], ['q', ['a b']]]);
    expect(request.queryInt('b', 7)).toBe(2);
    expect(Request.from({ method: 'GET', target: '/' }).rawQuery()).toBe('');
    expect([...Request.from({ method: 'GET', target: '/?' }).query()]).toEqual([]);
  });

  it('reads every form value of the body in order without nesting (HY-57)', () => {
    const request = Request.from({
      method: 'POST',
      target: '/',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Buffer.from('title=%ED%95%9C+%EA%B8%80&roles[]=a&empty&roles%5B%5D=b&x=1&x=2'),
    });
    expect([...request.form()]).toEqual([['title', ['한 글']], ['roles[]', ['a', 'b']], ['empty', ['']], ['x', ['1', '2']]]);
    expect(request.formString('x')).toBe('2');
    expect([...Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('a=1') }).form()]).toEqual([]);
  });

  it('reads the text fields of a multipart form and leaves out files', () => {
    const body = [
      '--XyZ', 'Content-Disposition: form-data; name="title"', '', '한 글', '--XyZ',
      'Content-Disposition: form-data; name="file"; filename="a.txt"', 'Content-Type: text/plain', '', 'file body', '--XyZ--', '',
    ].join('\r\n');
    const request = Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'multipart/form-data; boundary=XyZ' }, body: Buffer.from(body) });
    expect(request.formString('title')).toBe('한 글');
    expect(request.formString('file')).toBe('');
    const invalid = Buffer.concat([Buffer.from('--XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n'), Buffer.from([0xff]), Buffer.from('\r\n--XyZ--\r\n')]);
    expect(Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'multipart/form-data; boundary="XyZ"' }, body: invalid }).validInput()).toBe(false);
  });

  it('reads the path of HX-Current-URL (HY-11)', () => {
    const current = (url: string) => Request.from({ method: 'GET', target: '/', headers: { 'HX-Current-URL': url } }).currentPath();
    expect(current('http://localhost/?page=2')).toBe('/');
    expect(current('http://localhost/board/1#top')).toBe('/board/1');
    expect(current('http://localhost')).toBeNull();
  });
});
