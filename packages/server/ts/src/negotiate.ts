// Selects the media type of a request by its Accept header and answers its refusals (HY-116, HY-62). The app calls it
// after the routing; the selection itself is in accept.ts.
import { Accept } from './accept.js';
import { InvalidAccept } from './invalid-accept.js';
import { HYPER_JSON, type Request } from './request.js';
import { Response } from './response.js';

// The media types of the page and of the JSON of hyper, in the order of ties (HY-116).
export const PAGE_TYPE = 'text/html';
export const PAGE_AND_DATA = [PAGE_TYPE, HYPER_JSON];

// Selects the media type of a request among the page and the JSON of hyper by its Accept header (HY-116) and returns the
// request that holds it. A refusal is the response of HY-116 or HY-62: 400 for an invalid Accept, 406 with the served types
// when no type matches, and 406 when the selected type is not served by the path (`served`).
export function negotiate(request: Request, served: readonly string[]): Request | Response {
  let selected: string | null;
  try {
    selected = Accept.select(request.header('Accept'), PAGE_AND_DATA);
  } catch (error) {
    if (error instanceof InvalidAccept) return refusal(400, 'Bad Request');
    throw error;
  }
  if (selected === null) return refusal(406, served.map((type) => `${type}\n`).join(''));
  if (!served.includes(selected)) return refusal(406, 'Not Acceptable');
  return request.withSelectedType(selected);
}

// Returns a plain text refusal that depends on the Accept header (HY-116, HY-62).
function refusal(status: number, body: string): Response {
  return new Response(status, { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept' }, body);
}
