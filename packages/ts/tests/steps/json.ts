// The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
import { JsonCodec } from '../../src/data/json-codec.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';

function text(reader: CaseReader): string {
  const json = reader.input('json');
  return typeof json === 'string' ? json : '';
}

export const steps = {
  encode(reader: CaseReader): void {
    const json = text(reader);
    const outcome = failureOf(() => JsonCodec.encode(JsonCodec.decode(json)));
    reader.compare('expected', outcome.result);
    reader.compare('raises', outcome.raises);
  },
  decode(reader: CaseReader): void {
    const json = text(reader);
    const outcome = failureOf(() => {
      JsonCodec.decode(json);
      return 'value';
    });
    reader.compare('result', outcome.result);
    reader.compare('raises', outcome.raises);
  },
};
