// The steps of contracts/request.json: the text that a host gives a request (HY-42.6) and the files of a request
// (HY-113.2).
import { Request } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { bytesOf } from '../support.js';

export const steps = {
  // Creates a request of the texts of the case and records the error of its creation, or null.
  texts(reader: CaseReader): void {
    let failure: unknown = null;
    try {
      new Request({
        method: 'GET',
        path: reader.input('path') as string,
        query: reader.input('query') as string,
        headers: Object.fromEntries(reader.input('headers') as Map<string, string>),
      });
    } catch (error) {
      failure = error;
    }
    reader.outcome('request', failure);
  },
  // Reads the body of the case as a request and records the last file of each name and the pairs of the files.
  files(reader: CaseReader): void {
    const request = new Request({ method: 'POST', path: '/', headers: { 'Content-Type': bytesOf(reader.input('type') as string).toString('latin1') }, body: bytesOf(reader.input('body') as string) });
    reader.compare('last', (reader.input('names') as string[]).map((name) => request.file(name)?.filename() ?? null));
    reader.compare('pairs', request.files().map(([name, files]) => [name, files.map((file) => file.filename())]));
  },
};
