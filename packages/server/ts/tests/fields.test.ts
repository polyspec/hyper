// The form fields beyond the conformance cases of contracts/fields.json (HY-56, HY-57).
import { describe, expect, it } from 'vitest';
import { formFields } from '../src/form.js';

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
