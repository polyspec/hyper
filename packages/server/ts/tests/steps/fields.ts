// The urlencoded and multipart steps of contracts/fields.json (HY-56, HY-57, HY-113): a body is text whose characters are its bytes.
import { fileParts, formFields, parseUrlEncoded } from '../../src/form.js';
import type { CaseReader } from '../case-reader.js';

// The fields of a parse as the case states them: null when the body is refused, else its values in order.
function fieldsOf(fields: { valid: boolean; values: Iterable<unknown> }): unknown[] | null {
  return fields.valid ? [...fields.values] : null;
}

export const steps = {
  urlencoded(reader: CaseReader): void {
    const text = reader.input('text') as string;
    reader.compare('fields', fieldsOf(parseUrlEncoded(Buffer.from(text, 'utf8').toString('latin1'))));
  },
  multipart(reader: CaseReader): void {
    const type = reader.input('type') as string;
    const body = reader.input('body') as string;
    const bytes = Buffer.from(body, 'latin1');
    reader.compare('fields', fieldsOf(formFields(type, bytes)));
    const files = fileParts(type, bytes);
    reader.compare(
      'files',
      files.valid
        ? [...files.values].flatMap(([, values]) =>
            values.map((file) => ({ name: file.name, filename: file.filename, contentType: file.contentType, content: Buffer.from(file.content).toString('latin1') })),
          )
        : null,
    );
  },
};
