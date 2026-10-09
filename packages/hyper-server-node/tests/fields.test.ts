// The cases of conformance/fields.json (HY-56, HY-57), which PHP passes in FieldsTest. A urlencoded text is the
// UTF-8 encoding of its JSON string, which node:http gives as characters that are bytes; a multipart body is text
// whose characters are its bytes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formFields, parseUrlEncoded } from '../src/form.js';

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/fields.json', import.meta.url), 'utf8')) as {
  urlencoded: { label: string; text: string; fields: [string, string[]][] | null }[];
  multipart: { label: string; type: string; body: string; fields: [string, string[]][] | null }[];
};

describe('parseUrlEncoded conformance', () => {
  it.each(fixture.urlencoded.map((item) => [item.label, item] as const))('%s', (_label, item) => {
    const fields = parseUrlEncoded(Buffer.from(item.text, 'utf8').toString('latin1'));
    if (item.fields === null) {
      expect(fields.valid).toBe(false);
      return;
    }
    expect(fields.valid).toBe(true);
    expect([...fields.values]).toEqual(item.fields);
  });
});

describe('formFields conformance of multipart bodies', () => {
  it.each(fixture.multipart.map((item) => [item.label, item] as const))('%s', (_label, item) => {
    const fields = formFields(item.type, Buffer.from(item.body, 'latin1'));
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
