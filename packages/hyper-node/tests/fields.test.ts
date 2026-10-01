// The cases of conformance/fields.json (HY-56), which PHP passes in FieldsTest. A case text is the UTF-8 encoding
// of its JSON string; node:http gives such text as characters that are bytes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseUrlEncoded } from '../src/form.js';

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/fields.json', import.meta.url), 'utf8')) as {
  cases: { label: string; text: string; fields: [string, string[]][] | null }[];
};

describe('parseUrlEncoded conformance', () => {
  it.each(fixture.cases.map((item) => [item.label, item] as const))('%s', (_label, item) => {
    const fields = parseUrlEncoded(Buffer.from(item.text, 'utf8').toString('latin1'));
    if (item.fields === null) {
      expect(fields.valid).toBe(false);
      return;
    }
    expect(fields.valid).toBe(true);
    expect([...fields.values]).toEqual(item.fields);
  });
});
