// The JSON text of the servers (HY-54): the text of a value with rules.json_write of the core, and the reading of a
// JSON text with rules.json_read of the core. The core writes the JSON value of a page response (HY-17).
import { rules } from '../app/core-rules.js';
import { type Value } from './values.js';

/** @internal */
export class JsonCodec {
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
