// The cases of contracts/fields.json (HY-56, HY-57), which PHP passes in FieldsTest. A urlencoded text is the
// UTF-8 encoding of its JSON string, which node:http gives as characters that are bytes; a multipart body is text
// whose characters are its bytes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formFields, parseUrlEncoded } from '../src/form.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/fields.json', import.meta.url), 'utf8')));

describe('parseUrlEncoded conformance', () => {
  it.each(list(fixture.urlencoded).map(record).map((item) => [text(item.label), item] as const))('%s', (_label, item) => {
    const fields = parseUrlEncoded(Buffer.from(text(item.text), 'utf8').toString('latin1'));
    if (item.fields === null) {
      expect(fields.valid).toBe(false);
      return;
    }
    expect(fields.valid).toBe(true);
    expect([...fields.values]).toEqual(item.fields);
  });
});

describe('formFields conformance of multipart bodies', () => {
  it.each(list(fixture.multipart).map(record).map((item) => [text(item.label), item] as const))('%s', (_label, item) => {
    const fields = formFields(text(item.type), Buffer.from(text(item.body), 'latin1'));
    if (item.fields === null) {
      expect(fields.valid).toBe(false);
      return;
    }
    expect(fields.valid).toBe(true);
    expect([...fields.values]).toEqual(item.fields);
  });
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
});
