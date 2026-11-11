// The refusal of a file name that is not UTF-8 (HY-42). The file parts of the cases of contracts/fields.json are in
// steps/fields.ts; the file limit of HY-114 is tested with the application in app.test.ts.
import { expect, it } from 'vitest';
import { bytesOf } from '../src/form.js';
import { Request } from '../src/request.js';

it('file parts whose name is not UTF-8 are refused like a name that is not UTF-8 (HY-42)', () => {
  const body = bytesOf('--x\r\nContent-Disposition: form-data; name="f"; filename="\xff.txt"\r\n\r\nQ\r\n--x--\r\n');
  const request = Request.from({ method: 'POST', target: '/', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body });
  expect(request.validInput()).toBe(false);
});
