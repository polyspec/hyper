// The encode and decode steps of contracts/json.json (HY-17, HY-38, HY-40, HY-44).
import type { Value } from '@polyspec/template/render';
import { decodeJson, encodeJson, inDataModel, JsonDecodeError, OutsideNumber, type DecodedValue } from '../../src/json.js';
import type { CaseReader } from '../case-reader.js';

// Encoding writes every finite number, also one outside the data model, as PHP json_encode does.
function finite(value: DecodedValue): Value {
  if (value instanceof OutsideNumber) return Number(value.literal);
  if (Array.isArray(value)) return value.map(finite);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, finite(item)]));
  return value;
}

export const steps = {
  encode(reader: CaseReader): void {
    reader.compare('expected', encodeJson(finite(decodeJson(reader.input('json') as string))));
  },
  decode(reader: CaseReader): void {
    let result: string;
    try {
      result = inDataModel(decodeJson(reader.input('json') as string)) ? 'value' : 'outside';
    } catch (error) {
      if (!(error instanceof JsonDecodeError)) throw error;
      result = 'error';
    }
    reader.compare('result', result);
  },
};
