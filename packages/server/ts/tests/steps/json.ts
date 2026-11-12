// The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
import { JsonCodec, type DecodedValue } from '../../src/data/json-codec.js';
import { JsonDecodeError } from '../../src/data/json-decode-error.js';
import { OutsideNumber } from '../../src/data/outside-number.js';
import type { Value } from '../../src/data/values.js';
import type { CaseReader } from '../case-reader.js';

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
    reader.compare('expected', JsonCodec.encode(finite(JsonCodec.decode(text(reader)))));
  },
  decode(reader: CaseReader): void {
    let result: string;
    try {
      result = JsonCodec.inDataModel(JsonCodec.decode(text(reader))) ? 'value' : 'outside';
    } catch (error) {
      if (!(error instanceof JsonDecodeError)) throw error;
      result = 'error';
    }
    reader.compare('result', result);
  },
};
