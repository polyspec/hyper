// The urlencoded cases of contracts/fields.json (HY-56, HY-57): a urlencoded text is the UTF-8 encoding of its JSON string,
// which node:http gives as characters that are bytes. The PHP and the Python server pass the same cases. Each case is a
// top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parseUrlEncoded } from '../src/form.js';
import { expectFields, list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/fields.json', import.meta.url), 'utf8')));

it.each(list(fixture.urlencoded).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expectFields(parseUrlEncoded(Buffer.from(text(item.text), 'utf8').toString('latin1')), item.fields);
});
