// The context of an application (HY-124 to HY-128): the map that its handler returns and the check of the
// Hyper-Context header. The core checks the map (HY-44), computes its hash with the build (HY-125), writes the member
// `context` of a JSON response and places the context in the shared data of a document (HY-10).
import type { Value } from '../data/values.js';
import { rules } from './core-rules.js';

// The context handler of an application: a function of the selection value that returns a Map, or a promise of one (HY-106).
export type ContextHandler = (selection: unknown) => Map<string, Value> | Promise<Map<string, Value>>;

/** @internal */
export class Context {
  // Calls the context handler with the selection value and returns its map; a value that is not a Map fails (HY-124,
  // HY-43). The step of the core that receives the map checks its values (HY-44.10).
  static async held(handler: ContextHandler, selection: unknown): Promise<ReadonlyMap<string, unknown>> {
    const value: unknown = await handler(selection);
    if (!(value instanceof Map)) throw new Error('hyper: the context handler did not return a map (HY-124)');
    return value;
  }

  // Returns true for a request without Hyper-Context or with a context hash, 64 lowercase hexadecimal (HY-127).
  static validHeader(value: string | null): boolean {
    return rules().contextValidHeader(value);
  }
}
