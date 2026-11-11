// The urlencoded and multipart steps of contracts/fields.json (HY-56, HY-57, HY-113): a urlencoded text is the UTF-8
// encoding of its JSON string, and a multipart type and body are text whose characters are their bytes.
import { Fields } from '../../src/fields.js';
import { Files } from '../../src/files.js';
import { Multipart } from '../../src/multipart.js';
import type { CaseReader } from '../case-reader.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

function fieldsOf(fields: Fields | null): unknown {
  return fields?.pairs() ?? null;
}

function filesOf(files: Files | null): unknown {
  if (files === null) return null;
  return files.pairs().flatMap(([, list]) =>
    list.map((file) => ({ name: file.name(), filename: file.filename(), contentType: file.contentType(), content: Buffer.from(file.content()).toString('latin1') })),
  );
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
    const whole = [fieldsOf(Fields.fromBody(type, body)), filesOf(Files.fromBody(type, body))];
    // HY-131.6: the body read in two chunks, divided at every position, gives the result of the whole body, and the
    // reader holds between two chunks at most its bound; the first division that differs is the result of the case.
    const boundary = Multipart.boundary(type);
    let result = whole;
    if (boundary !== null) {
      const bound = Math.max(8192 + 3, boundary.length + 3);
      for (let at = 0; at <= body.length && result === whole; at += 1) {
        const parts = new Multipart(boundary);
        for (const chunk of [body.subarray(0, at), body.subarray(at)]) {
          parts.feed(chunk);
          if (parts.buffered() > bound) throw new Error(`the reader holds ${parts.buffered()} bytes after a chunk that ends at ${at}; its bound is ${bound}`);
        }
        const read = parts.result();
        const divided = [fieldsOf(read?.[0] ?? null), filesOf(read?.[1] ?? null)];
        if (JSON.stringify(divided) !== JSON.stringify(whole)) result = divided;
      }
    }
    reader.compare('fields', result[0]);
    reader.compare('files', result[1]);
  },
};
