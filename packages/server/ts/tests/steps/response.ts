// The steps of contracts/response.json (HY-106.17): a response that an application makes and its copies with a header.
import { Response } from '../../src/response.js';
import type { CaseReader } from '../case-reader.js';
import { listOf, textOf } from '../inputs.js';

// Returns the pairs of a name and a value of a case field, in their order.
function pairsOf(value: unknown, what: string): [string, string][] {
  return listOf(value, what).map((pair): [string, string] => {
    const [name, item] = listOf(pair, `a pair of ${what}`);
    return [textOf(name, `a name of ${what}`), textOf(item, `a value of ${what}`)];
  });
}

// Returns the members status, headers and body of a response.
function membersOf(response: Response): { status: number; headers: Record<string, string | string[]>; body: string } {
  return { status: response.status, headers: response.headers, body: response.body };
}

export const steps = {
  // Makes the response with the constructor or with Response.text, applies withHeader for each pair of `with` to the
  // response that the last call returned, and compares the last response and the headers of the first.
  values(reader: CaseReader): void {
    const status = reader.input('status');
    if (typeof status !== 'number' || !Number.isInteger(status)) throw new Error('the case field status is not an integer');
    const body = textOf(reader.input('body'), 'the case field body');
    const make = textOf(reader.input('make'), 'the case field make');
    let first: Response;
    if (make === 'constructor') {
      const headers = reader.has('headers') ? pairsOf(reader.input('headers'), 'the case field headers') : [];
      first = new Response(status, Object.fromEntries(headers), body);
    } else if (make === 'text') first = Response.text(status, body);
    else throw new Error(`the word ${make} of make is unknown`);
    let last = first;
    for (const [name, value] of reader.has('with') ? pairsOf(reader.input('with'), 'the case field with') : []) last = last.withHeader(name, value);
    reader.compare('response', membersOf(last));
    reader.compare('original', first.headers);
  },
};
