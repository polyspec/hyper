// The multipart cases of contracts/fields.json (HY-56, HY-57): a multipart body is text whose characters are its bytes.
// The PHP and the Python server pass the same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { formFields } from '../src/form.js';
import { expectFields, list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/fields.json', import.meta.url), 'utf8')));

it.each(list(fixture.multipart).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  expectFields(formFields(text(item.type), Buffer.from(text(item.body), 'latin1')), item.fields);
});
