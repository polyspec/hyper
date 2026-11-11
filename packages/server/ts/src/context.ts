// The context of an application (HY-124, HY-125, HY-127, HY-128): the value that its handler returns, the hash of that
// value with its build, and the check of the Hyper-Context header. The use in the page and the app is in page.ts and app.ts.
import { createHash } from 'node:crypto';
import { JsonCodec } from './json-codec.js';
import type { Request } from './request.js';
import { type MapValue, type Value } from './values.js';

// The context handler of an application: a function of the selection value that returns a Map, or a promise of one (HY-106).
export type ContextHandler = (selection: unknown) => Map<string, Value> | Promise<Map<string, Value>>;

// A Hyper-Context value: the context hash of HY-125, 64 lowercase hexadecimal characters (HY-127).
export const HYPER_CONTEXT = /^[0-9a-f]{64}$/;

// Calls the context handler and checks its map with HY-44; a value that is not a Map, or that holds a value outside the
// data model, fails (HY-124, HY-43).
export async function heldContext(handler: ContextHandler, selection: unknown): Promise<MapValue> {
  const value: unknown = await handler(selection);
  if (!(value instanceof Map)) throw new Error('hyper: the context handler did not return a Map (HY-124)');
  if (!JsonCodec.inDataModel(value)) throw new Error('hyper: the context holds a value outside the data model (HY-44)');
  return value;
}

// Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`, the JSON text
// of the context and `}` (HY-125).
export function contextHash(build: string, text: string): string {
  return createHash('sha256').update(`{"build":"${build}","context":${text}}`).digest('hex');
}

// Returns true when the request holds the hash of the context that the server holds (HY-128).
export function namesHash(request: Request, hash: string): boolean {
  return request.header('Hyper-Context') === hash;
}

// Returns the shared data of a document with the context in its place (HY-10): after csrf, and when HY-73 removed csrf,
// right after title. The context never comes before title; without title or csrf it comes first.
export function withContext(shared: MapValue, held: MapValue): MapValue {
  const anchor = shared.has('csrf') ? 'csrf' : 'title';
  const entries: [string, Value][] = [];
  let placed = false;
  for (const [name, item] of shared) {
    entries.push([name, item]);
    if (name === anchor) {
      entries.push(['context', held]);
      placed = true;
    }
  }
  if (!placed) entries.unshift(['context', held]);
  return new Map(entries);
}
