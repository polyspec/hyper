// The urlencoded and multipart steps of contracts/fields.json (HY-56, HY-57, HY-113): a urlencoded text is the UTF-8
// encoding of its JSON string, and a multipart type and body are text whose characters are their bytes.
import { Fields } from '../../src/fields.js';
import { Files } from '../../src/files.js';
import type { CaseReader } from '../case-reader.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

export const steps = {
  // Parses the text and records its pairs and its names, or null for both when it fails with HY-42 (HY-56).
  urlencoded(reader: CaseReader): void {
    const fields = Fields.parse(Buffer.from(text(reader, 'text'), 'utf8'));
    reader.compare('fields', fields?.pairs() ?? null);
    reader.compare('names', fields?.names() ?? null);
  },
  // Reads the form values and the files of the body, or null for each when the body fails with HY-42 (HY-57, HY-113).
  multipart(reader: CaseReader): void {
    const type = Buffer.from(text(reader, 'type'), 'latin1').toString('latin1');
    const body = Buffer.from(text(reader, 'body'), 'latin1');
    reader.compare('fields', Fields.fromBody(type, body)?.pairs() ?? null);
    const files = Files.fromBody(type, body);
    reader.compare(
      'files',
      files === null
        ? null
        : files.pairs().flatMap(([, list]) =>
            list.map((file) => ({ name: file.name(), filename: file.filename(), contentType: file.contentType(), content: Buffer.from(file.content()).toString('latin1') })),
          ),
    );
  },
};
