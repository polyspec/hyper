// The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with rules.json_write of the core, and
// the reading of a JSON text with rules.json_read of the core.
import { rules } from '../app/core-rules.js';
import { type MapValue, type Value } from './values.js';

/** @internal */
export class JsonCodec {
  // Returns the JSON response value of a page (HY-17, HY-128): `build` is the build id and `context` the member context
  // of HY-128 when the response has one, both after `params`; `regions` holds the loader data by region name and `kept`
  // the kept values by region name and path.
  static value(timezone: string, route: string, params: MapValue, build: string, context: MapValue | null, shared: MapValue, regions: MapValue, kept: MapValue): MapValue {
    const entries: [string, Value][] = [
      ['env', new Map([['timezone', timezone]])],
      ['route', route],
      ['params', params],
      ['build', build],
    ];
    if (context !== null) entries.push(['context', context]);
    entries.push(['shared', shared], ['regions', regions], ['kept', kept]);
    return new Map(entries);
  }

  // Returns the JSON text of a value of the data model: rules.json_write of the core (HY-54.18, HY-54.19). A value
  // that has no JSON form fails with the kind of the data model, as the core raises it (HY-44).
  static encode(value: Value): string {
    return rules().jsonCodecEncode(value);
  }

  // Reads a JSON text to a value of the data model with maps in document order: rules.json_read of the core
  // (HY-54.20). A text that json refuses fails with the kind malformed_json, and a value outside the data model with
  // the kind of the data model, as the core raises them (HY-54.21).
  static decode(text: string): Value {
    return rules().jsonCodecDecode(text);
  }
}
