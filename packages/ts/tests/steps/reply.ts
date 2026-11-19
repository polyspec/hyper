// The steps of contracts/reply.json (HY-52, HY-60, HY-69, HY-72, HY-92, HY-103): the reply of a request.
import { Reply } from '../../src/http/reply.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';
import { decoded } from './session-requests.js';

// Calls a method of the reply with the arguments as a JavaScript caller may give them, of any type (HY-52.15).
export function call(reply: Reply, method: string, args: unknown[]): void {
  switch (method) {
    case 'cookie':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.cookie(...args);
      return;
    case 'removeCookie':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.removeCookie(...args);
      return;
    case 'cacheControl':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.cacheControl(...args);
      return;
    case 'referrerPolicy':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.referrerPolicy(...args);
      return;
    case 'status':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.status(...args);
      return;
    case 'note':
      // @ts-expect-error -- a caller passes the decoded arguments, of any type
      reply.note(...args);
      return;
    case 'renewSession':
      reply.renewSession();
      return;
    case 'embedData':
      reply.embedData();
      return;
    default:
      throw new Error(`the method ${method} of the case is unknown`);
  }
}

// Makes a reply and applies the calls of the case in order until one fails, and compares the failure.
function applied(reader: CaseReader, compareFailure: boolean): Reply {
  const entries = reader.input('calls');
  if (!Array.isArray(entries)) throw new Error('the calls of the case are not a list');
  const calls = entries.map((entry: unknown): [string, unknown[]] => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) throw new Error('a call of the case is not a method and a list of JSON texts');
    // The JSON text gives the value as a handler gives it: an integer outside ±(2^53 − 1) is a bigint (HY-44).
    return [entry[0], entry[1].map((text: unknown) => decoded(text))];
  });
  const reply = new Reply();
  const outcome = failureOf(() => {
    for (const [method, args] of calls) call(reply, method, args);
  });
  if (compareFailure) {
    reader.compare('raises', outcome.raises);
  } else if (outcome.raises !== null) {
    throw new Error(`a call of the case fails: ${outcome.raises.message}`);
  }
  return reply;
}

export const steps = {
  // Records the Set-Cookie values of the reply (HY-52).
  cookies(reader: CaseReader): void {
    const secure = reader.has('secure') && reader.input('secure') === true;
    reader.compare('headers', applied(reader, true).cookieHeaders(secure));
  },
  // Records the Cache-Control of the reply (HY-52).
  cacheControl(reader: CaseReader): void {
    reader.compare('value', applied(reader, true).cacheControlValue());
  },
  // Records the Referrer-Policy of the reply and its headers (HY-103).
  referrerPolicy(reader: CaseReader): void {
    const reply = applied(reader, true);
    const value = reply.referrerPolicyValue();
    reader.compare('value', value);
    reader.compare('headers', new Map(value === null ? [] : [['Referrer-Policy', value]]));
  },
  // Records the page status of the reply (HY-69).
  status(reader: CaseReader): void {
    reader.compare('value', applied(reader, true).statusValue());
  },
  // Records the notes of the reply (HY-60).
  notes(reader: CaseReader): void {
    reader.compare('notes', applied(reader, true).notes());
  },
  // Records the renewal, taken twice, and the embedding of the reply (HY-72, HY-92).
  flags(reader: CaseReader): void {
    const reply = applied(reader, false);
    reader.compare('renewals', [reply.takeRenewal(), reply.takeRenewal()]);
    reader.compare('embeds', reply.embedsData());
  },
};
