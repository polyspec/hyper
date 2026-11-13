// The context of an application (HY-124 to HY-128): the map that its handler returns, its JSON text (HY-54), its hash
// with the build (HY-125), the member `context` of a JSON response, the check of the Hyper-Context header and the place
// of the context in the shared data of a document (HY-10).
import { createHash } from 'node:crypto';
import { withContext as placeContext } from '@polyspec/hyper-client';
import { DataModel } from '../data/data-model.js';
import { JsonCodec } from '../data/json-codec.js';
import { type MapValue, type Value } from '../data/values.js';

// The context handler of an application: a function of the selection value that returns a Map, or a promise of one (HY-106).
export type ContextHandler = (selection: unknown) => Map<string, Value> | Promise<Map<string, Value>>;

/** @internal */
export class Context {
  // Calls the context handler with the selection value and returns its map, which belongs to the data model; a value
  // that is not a Map, or that holds a value outside the data model, fails (HY-124, HY-44, HY-43).
  static async held(handler: ContextHandler, selection: unknown): Promise<MapValue> {
    const value: unknown = await handler(selection);
    if (!(value instanceof Map)) throw new Error('hyper: the context handler did not return a map (HY-124)');
    DataModel.check(new Map([['context', value]]));
    return value;
  }

  // Returns the JSON text of HY-54 of a context map.
  static text(map: MapValue): string {
    return JsonCodec.encode(map);
  }

  // Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`, the JSON
  // text of the context and `}` (HY-125).
  static hash(build: string, text: string): string {
    return createHash('sha256').update(`{"build":"${build}","context":${text}}`).digest('hex');
  }

  // Returns the member `context` of a JSON response (HY-128): `hash`, and `value` unless the held hash of the request
  // equals the hash (HY-127). A document that embeds its data passes null, so it always has the value.
  static member(build: string, map: MapValue, held: string | null): MapValue {
    const hash = Context.hash(build, Context.text(map));
    return new Map<string, Value>(held === hash ? [['hash', hash]] : [['hash', hash], ['value', map]]);
  }

  // Returns true for a request without Hyper-Context or with a context hash, 64 lowercase hexadecimal (HY-127).
  static validHeader(value: string | null): boolean {
    return value === null || /^[0-9a-f]{64}$/u.test(value);
  }

  // Returns the shared data of a document with the context in its place (HY-10, HY-128), with the browser code that
  // renders the documents of the Node server (HY-128.4), so that both place it alike.
  static withContext(shared: MapValue, map: MapValue): MapValue {
    return placeContext(shared, map);
  }
}
