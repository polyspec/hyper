// Selects the media type of a request by its Accept header and answers its refusals (HY-116, HY-62). The app calls it
// after the routing; the selection itself is in media-selection.ts.
import { InvalidAccept } from './invalid-accept.js';
import { MediaSelection, type Selected } from './media-selection.js';
import type { Entry } from './representation-entries.js';
import { HYPER_JSON, type Request } from './request.js';
import { Response } from './response.js';

// The media types of the page and of the JSON of hyper, in the order of ties (HY-116).
export const PAGE_TYPE = 'text/html';
export const PAGE_AND_DATA = [PAGE_TYPE, HYPER_JSON];

// Selects the media type of a request among the page, the JSON of hyper and the representations of its route by its
// Accept header (HY-116). A refusal is the response of HY-116 or HY-62: 400 for an invalid Accept, 406 with the types
// that the path serves, the page types of `served` and the entries of `listed`, when no type matches, and 406 when the
// selected page type is not served by the path.
export function negotiate(request: Request, served: readonly string[], entries: readonly Entry[], listed: readonly Entry[]): Selected | Response {
  let selected: Selected | null;
  try {
    selected = MediaSelection.select(request.header('Accept'), PAGE_AND_DATA, entries);
  } catch (error) {
    if (error instanceof InvalidAccept) return refusal(400, 'Bad Request');
    throw error;
  }
  if (selected === null) return refusal(406, MediaSelection.listing(served, listed));
  if (selected.entry === null && !served.includes(selected.type)) return refusal(406, 'Not Acceptable');
  return selected;
}

// Returns a plain text refusal that depends on the Accept header (HY-116, HY-62).
export function refusal(status: number, body: string): Response {
  return new Response(status, { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept' }, body);
}
