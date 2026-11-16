// The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
import { JsonCodec, type DecodedValue } from '../../src/data/json-codec.js';
import { OutsideNumber } from '../../src/data/outside-number.js';
import type { Value } from '../../src/data/values.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';

// Encoding writes every finite number, also one outside the data model, as PHP json_encode does.
function finite(value: DecodedValue): Value {
  if (value instanceof OutsideNumber) {
    const outside: OutsideNumber = value;
    return Number(outside.literal);
  }
  if (Array.isArray(value)) return value.map(finite);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, finite(item)]));
  return value;
}

function text(reader: CaseReader): string {
  const json = reader.input('json');
  return typeof json === 'string' ? json : '';
}

export const steps = {
  encode(reader: CaseReader): void {
    const json = text(reader);
    const outcome = failureOf(() => JsonCodec.encode(finite(JsonCodec.decode(json))));
    reader.compare('expected', outcome.result);
    reader.compare('raises', outcome.raises);
  },
  decode(reader: CaseReader): void {
    const json = text(reader);
    const outcome = failureOf(() => (JsonCodec.inDataModel(JsonCodec.decode(json)) ? 'value' : 'outside'));
    reader.compare('result', outcome.result);
    reader.compare('raises', outcome.raises);
  },
};
