// The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of PHP json_encode with
// JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES, and the decoding of kept values as PHP json_decode reads them. An
// instance reads one JSON text from its start to its end.
import { DataModel } from './data-model.js';
import { JsonDecodeError } from './json-decode-error.js';
import { OutsideNumber } from './outside-number.js';
import { MAX_SAFE_INTEGER, NativeObject, SafeString, type MapValue, type Value } from './values.js';

/** @internal */
export type DecodedValue = null | boolean | number | string | OutsideNumber | DecodedValue[] | Map<string, DecodedValue>;

const ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/u;
// PHP json_decode fails when containers nest 512 levels deep.
const MAX_DEPTH = 511;

/** @internal */
export class JsonCodec {
  // The position of the next character to read.
  private index = 0;
  private readonly text: string;

  private constructor(text: string) {
    this.text = text;
  }

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

  // Decodes JSON text as PHP json_decode($text, false) does, with maps for objects in document order. A number outside
  // ±(2^53 − 1) or one that is not finite is an OutsideNumber. Invalid text, a lone surrogate escape, a key that starts
  // with U+0000 or nesting deeper than 511 containers fails with JsonDecodeError.
  static decode(text: string): DecodedValue {
    const reader = new JsonCodec(text);
    const result = reader.parseValue(0);
    reader.skipWhitespace();
    if (reader.index < text.length) reader.failAt('unexpected character after the value');
    return result;
  }

  // Returns true when a decoded value is a value of the data model (HY-44, HY-54): a number outside ±(2^53 − 1) or one
  // that is not finite, which decodes as an OutsideNumber, and nesting deeper than the data model allows, are not.
  static inDataModel(value: Value | DecodedValue): value is Value {
    return DataModel.contains(value);
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

  // Returns the text of decoded string units, in which an escaped high and low surrogate are one character; a lone
  // surrogate fails, as PHP json_decode accepts a pair and refuses a lone half.
  private static combineSurrogates(text: string): string {
    if (!text.isWellFormed()) throw new JsonDecodeError('hyper: lone surrogate');
    return text;
  }

  // Fails the decoding at the current position.
  private failAt(message: string): never {
    throw new JsonDecodeError(`hyper: ${message} at offset ${this.index}`);
  }

  // Skips the JSON white space.
  private skipWhitespace(): void {
    while (this.index < this.text.length && ' \t\n\r'.includes(this.text.charAt(this.index))) this.index++;
  }

  // Reads a string from its opening quote.
  private parseString(): string {
    this.index++;
    let result = '';
    for (;;) {
      const char = this.text[this.index];
      if (char === undefined) return this.failAt('unterminated string');
      if (char === '"') {
        this.index++;
        return JsonCodec.combineSurrogates(result);
      }
      if (char < ' ') this.failAt('control character in string');
      if (char !== '\\') {
        result += char;
        this.index++;
        continue;
      }
      const escape = this.text[this.index + 1];
      const simple = escape === undefined ? undefined : SIMPLE_ESCAPES[escape];
      if (simple !== undefined) {
        result += simple;
        this.index += 2;
      } else if (escape === 'u' && /^[0-9A-Fa-f]{4}$/u.test(this.text.slice(this.index + 2, this.index + 6))) {
        result += String.fromCharCode(Number.parseInt(this.text.slice(this.index + 2, this.index + 6), 16));
        this.index += 6;
      } else {
        this.failAt('invalid escape');
      }
    }
  }

  // Reads a number: an integer literal is an integer, so -0 is 0, and a float literal -0.0 stays negative zero.
  private parseNumber(): number | OutsideNumber {
    const match = NUMBER.exec(this.text.slice(this.index));
    if (match === null) return this.failAt('invalid number');
    const literal = match[0];
    this.index += literal.length;
    const value = Number(literal);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_INTEGER) return new OutsideNumber(literal);
    return match[2] === undefined && match[3] === undefined ? value + 0 : value;
  }

  // Reads a value at a nesting depth.
  private parseValue(depth: number): DecodedValue {
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === '{' || char === '[') {
      if (depth >= MAX_DEPTH) this.failAt('nesting is too deep');
      this.index++;
      this.skipWhitespace();
      const close = char === '{' ? '}' : ']';
      const map = new Map<string, DecodedValue>();
      const list: DecodedValue[] = [];
      if (this.text[this.index] === close) {
        this.index++;
        return char === '{' ? map : list;
      }
      for (;;) {
        if (char === '{') {
          this.skipWhitespace();
          if (this.text[this.index] !== '"') this.failAt('expected a string key');
          const key = this.parseString();
          if (key.startsWith('\u0000')) this.failAt('key starts with U+0000');
          this.skipWhitespace();
          if (this.text[this.index] !== ':') this.failAt('expected ":"');
          this.index++;
          map.set(key, this.parseValue(depth + 1));
        } else {
          list.push(this.parseValue(depth + 1));
        }
        this.skipWhitespace();
        if (this.text[this.index] === ',') {
          this.index++;
          continue;
        }
        if (this.text[this.index] === close) {
          this.index++;
          return char === '{' ? map : list;
        }
        this.failAt(`expected "," or "${close}"`);
      }
    }
    if (char === '"') return this.parseString();
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(word, this.index)) {
        this.index += word.length;
        return result;
      }
    }
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) return this.parseNumber();
    return this.failAt('unexpected character');
  }
}
