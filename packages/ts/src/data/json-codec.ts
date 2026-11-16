// The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of PHP json_encode with
// JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES, and the reading of a JSON text with rules.json_read of the core.
import { rules } from '../app/core-rules.js';
import { MAX_SAFE_INTEGER, NativeObject, SafeString, type MapValue, type Value } from './values.js';

const ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\u2028': '\\u2028', '\u2029': '\\u2029' };

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

  // Returns the JSON text of a value as PHP json_encode writes it; a string with a lone surrogate, which is not UTF-8, a
  // number that is not finite or an application object fails (HY-44).
  static encode(value: Value): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return JsonCodec.encodeNumber(value);
    if (typeof value === 'string') return JsonCodec.encodeString(value);
    if (value instanceof SafeString) return JsonCodec.encodeString(value.text);
    if (Array.isArray(value)) return `[${value.map((item) => JsonCodec.encode(item)).join(',')}]`;
    if (value instanceof Map) return `{${[...value].map(([key, item]) => `${JsonCodec.encodeString(key)}:${JsonCodec.encode(item)}`).join(',')}}`;
    if (value instanceof NativeObject) throw new TypeError('hyper: an application object has no JSON text');
    throw new TypeError('hyper: the value is not a value of the data model');
  }

  // Reads a JSON text to a value of the data model with maps in document order: rules.json_read of the core
  // (HY-54.20). A text that json refuses fails with the kind malformed_json, and a value outside the data model with
  // the kind of the data model, as the core raises them (HY-54.21).
  static decode(text: string): Value {
    return rules().jsonCodecDecode(text);
  }

  // Writes an integer within ±(2^53 − 1) in decimal and another number with the shortest digits that read back as the
  // same number: positional when the decimal point position is between -3 and 17, and otherwise d.ddde±x with at least
  // one fraction digit; negative zero is -0 (HY-54).
  private static encodeNumber(value: number): string {
    if (!Number.isFinite(value)) throw new RangeError('hyper: a number that is not finite has no JSON text');
    if (Object.is(value, -0)) return '-0';
    if (Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_INTEGER) return String(value);
    const exponential = Math.abs(value).toExponential();
    const mantissa = exponential.slice(0, exponential.indexOf('e'));
    const exponent = exponential.slice(exponential.indexOf('e') + 1);
    const digits = mantissa.replace('.', '');
    const point = Number(exponent) + 1;
    let text: string;
    if (point < -3 || point > 17) {
      const power = point - 1;
      text = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : '0'}e${power < 0 ? '-' : '+'}${Math.abs(power)}`;
    } else if (point <= 0) {
      text = `0.${'0'.repeat(-point)}${digits}`;
    } else if (digits.length <= point) {
      text = digits + '0'.repeat(point - digits.length);
    } else {
      text = `${digits.slice(0, point)}.${digits.slice(point)}`;
    }
    return value < 0 ? `-${text}` : text;
  }

  // Escapes the quote, the backslash, the control characters below U+0020 and the line and paragraph separators U+2028
  // and U+2029; every other character, including / and DEL, stays as it is (HY-54).
  private static encodeString(text: string): string {
    JsonCodec.checkWellFormed(text);
    return `"${text.replace(/["\\\u2028\u2029[\p{Cc}--[\x7f-\x9f]]]/gv, (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
  }

  // Fails for a string with a lone surrogate, which has no UTF-8 form.
  private static checkWellFormed(text: string): void {
    if (!text.isWellFormed()) throw new TypeError('hyper: a string with a lone surrogate is not UTF-8');
  }
}
