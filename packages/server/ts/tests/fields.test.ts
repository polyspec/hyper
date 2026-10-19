// The cases of packages/server/php/tests/FieldsTest.php and packages/server/python/tests/test_fields.py (HY-56, HY-57):
// a urlencoded text is the UTF-8 encoding of its JSON string, which node:http gives as characters that are bytes; a
// multipart body is text whose characters are its bytes. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formFields, parseUrlEncoded } from '../src/form.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/fields.json', import.meta.url), 'utf8')));

it.each(list(fixture.urlencoded).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  const fields = parseUrlEncoded(Buffer.from(text(item.text), 'utf8').toString('latin1'));
  if (item.fields === null) {
    expect(fields.valid).toBe(false);
    return;
  }
  expect(fields.valid).toBe(true);
  expect([...fields.values]).toEqual(item.fields);
});

it.each(list(fixture.multipart).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  const fields = formFields(text(item.type), Buffer.from(text(item.body), 'latin1'));
  if (item.fields === null) {
    expect(fields.valid).toBe(false);
    return;
  }
  expect(fields.valid).toBe(true);
  expect([...fields.values]).toEqual(item.fields);
});

describe('formFields', () => {
  it('reads a urlencoded body and no other type (HY-57)', () => {
    const read = (type: string, body: string) => [...formFields(type, Buffer.from(body)).values];
    expect(read('application/x-www-form-urlencoded; charset=UTF-8', 'roles%5B%5D=a&roles[]=b')).toEqual([['roles[]', ['a', 'b']]]);
    expect(read('Application/X-WWW-Form-Urlencoded', 'a=1')).toEqual([['a', ['1']]]);
    expect(read('text/plain', 'a=1')).toEqual([]);
    expect(read('', 'a=1')).toEqual([]);
    expect(read('multipart/form-data', '--x--')).toEqual([]);
  });

  it('a name that is absent has no values (HY-56)', () => {
    const fields = formFields('application/x-www-form-urlencoded', Buffer.from('1=x'));
    expect(fields.values.has('1')).toBe(true);
    expect(fields.values.has('2')).toBe(false);
    expect(fields.values.get('2')).toBeUndefined();
  });
});
