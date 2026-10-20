// The decode cases of contracts/json.json (HY-38, HY-40, HY-44): kept values decoded as PHP json_decode reads them. PHP and
// Python pass the same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeJson, inDataModel, JsonDecodeError } from '../src/index.js';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/json.json', import.meta.url), 'utf8')));

it.each(list(fixture.decode).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  let result: string;
  try {
    result = inDataModel(decodeJson(text(item.json))) ? 'value' : 'outside';
  } catch (error) {
    if (!(error instanceof JsonDecodeError)) throw error;
    result = 'error';
  }
  expect(result).toBe(item.result);
});
