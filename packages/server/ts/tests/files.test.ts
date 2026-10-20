// File parts of a multipart request (HY-113): the files of each contract case that states them, and the refusal of a
// file name that is not UTF-8 (HY-42). The file limit of HY-114 is tested with the application in app.test.ts.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { bytesOf, fileParts } from '../src/form.js';
import { Request } from '../src/request.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/fields.json', import.meta.url), 'utf8')));

it.each(list(fixture.multipart).map(record).filter((item) => item.files !== undefined).map((item) => [text(item.id), item] as const))(
  'file parts of the contract case %s are its files',
  (_id, item) => {
    const files = fileParts(text(item.type), Buffer.from(text(item.body), 'latin1'));
    expect(files.valid).toBe(true);
    const got = [...files.values].flatMap(([, values]) =>
      values.map((file) => ({ name: file.name, filename: file.filename, contentType: file.contentType, content: Buffer.from(file.content).toString('latin1') })),
    );
    expect(got).toEqual(item.files);
  },
);

it('file parts whose name is not UTF-8 are refused like a name that is not UTF-8 (HY-42)', () => {
  const body = bytesOf('--x\r\nContent-Disposition: form-data; name="f"; filename="\xff.txt"\r\n\r\nQ\r\n--x--\r\n');
  const request = Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body });
  expect(request.validInput()).toBe(false);
});
