// JSON text of the data model with the bytes of the PHP server (HY-17, HY-54): PHP encodes with
// json_encode(JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) and decodes kept values with json_decode.
import { MAX_SAFE_INTEGER, NativeObject, SafeString, type Value } from './values.js';

// Returns the JSON text of a value as PHP json_encode writes it; a string with a lone surrogate, which is not
// UTF-8, or an application object fails (HY-44).
export function encodeJson(value: Value): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return encodeString(value);
  if (value instanceof SafeString) return encodeString(value.text);
  if (Array.isArray(value)) return `[${value.map(encodeJson).join(',')}]`;
  if (value instanceof Map) return `{${[...value].map(([key, item]) => `${encodeString(key)}:${encodeJson(item)}`).join(',')}}`;
  if (value instanceof NativeObject) throw new TypeError('hyper: an application object has no JSON text');
  throw new TypeError('hyper: the value is not a value of the data model');
}

// PHP writes an integer in decimal and a float with the shortest digits that read back as the same float:
// positional when the decimal point position is between -3 and 17, and otherwise d.ddde±x with at least one
// fraction digit. A float with an integer value has no fraction, and negative zero is -0.
export function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('hyper: a number that is not finite has no JSON text');
  if (Object.is(value, -0)) return '-0';
  if (Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_INTEGER) return String(value);
  const [mantissa, exponent] = Math.abs(value).toExponential().split('e') as [string, string];
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

const ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\u2028': '\\u2028', '\u2029': '\\u2029' };

// PHP escapes the quote, the backslash, the control characters below U+0020 and the line and paragraph
// separators U+2028 and U+2029; every other character, including / and DEL, stays as it is.
export function encodeString(text: string): string {
  if (!text.isWellFormed()) throw new TypeError('hyper: a string with a lone surrogate is not UTF-8');
  return `"${text.replace(/["\\\u0000-\u001f\u2028\u2029]/g, (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

// A number of a JSON text that has no value in the data model: a number outside ±(2^53 − 1) or one that is not
// finite (HY-38, HY-40).
export class OutsideNumber {
  readonly literal: string;

  constructor(literal: string) {
    this.literal = literal;
  }
}

export type DecodedValue = null | boolean | number | string | OutsideNumber | DecodedValue[] | Map<string, DecodedValue>;

export class JsonDecodeError extends Error {}

// PHP json_decode fails when containers nest 512 levels deep.
const MAX_DEPTH = 511;

// Decodes JSON text as PHP json_decode($text, false) does, with maps for objects in document order. A number
// outside ±(2^53 − 1) or one that is not finite is an OutsideNumber. Invalid text, a lone surrogate escape, a key that starts with U+0000 or nesting
// deeper than 511 containers fails.
export function decodeJson(text: string): DecodedValue {
  let index = 0;
  const fail = (message: string): never => {
    throw new JsonDecodeError(`hyper: ${message} at offset ${index}`);
  };
  const whitespace = (): void => {
    while (index < text.length && ' \t\n\r'.includes(text[index]!)) index++;
  };
  const string = (): string => {
    index++;
    let result = '';
    for (;;) {
      const char = text[index];
      if (char === undefined) fail('unterminated string');
      if (char === '"') {
        index++;
        if (!result.isWellFormed()) fail('lone surrogate');
        return result;
      }
      if (char! < ' ') fail('control character in string');
      if (char !== '\\') {
        result += char;
        index++;
        continue;
      }
      const escape = text[index + 1];
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (escape !== undefined && simple[escape] !== undefined) {
        result += simple[escape];
        index += 2;
      } else if (escape === 'u' && /^[0-9A-Fa-f]{4}$/.test(text.slice(index + 2, index + 6))) {
        result += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16));
        index += 6;
      } else {
        fail('invalid escape');
      }
    }
  };
  const number = (): number | OutsideNumber => {
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(index));
    if (match === null) return fail('invalid number');
    const literal = match[0];
    index += literal.length;
    const value = Number(literal);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_INTEGER) return new OutsideNumber(literal);
    // PHP reads an integer literal as an integer, so -0 is 0; a float literal -0.0 stays negative zero.
    return match[2] === undefined && match[3] === undefined ? value + 0 : value;
  };
  const value = (depth: number): DecodedValue => {
    whitespace();
    const char = text[index];
    if (char === '{' || char === '[') {
      if (depth >= MAX_DEPTH) fail('nesting is too deep');
      index++;
      whitespace();
      const close = char === '{' ? '}' : ']';
      const map = new Map<string, DecodedValue>();
      const list: DecodedValue[] = [];
      if (text[index] === close) {
        index++;
        return char === '{' ? map : list;
      }
      for (;;) {
        if (char === '{') {
          whitespace();
          if (text[index] !== '"') fail('expected a string key');
          const key = string();
          if (key.startsWith('\u0000')) fail('key starts with U+0000');
          whitespace();
          if (text[index] !== ':') fail('expected ":"');
          index++;
          map.set(key, value(depth + 1));
        } else {
          list.push(value(depth + 1));
        }
        whitespace();
        if (text[index] === ',') {
          index++;
          continue;
        }
        if (text[index] === close) {
          index++;
          return char === '{' ? map : list;
        }
        fail(`expected "," or "${close}"`);
      }
    }
    if (char === '"') return string();
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return result;
      }
    }
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) return number();
    return fail('unexpected character');
  };
  const result = value(0);
  whitespace();
  if (index < text.length) fail('unexpected character after the value');
  return result;
}

// Returns true when a decoded value contains no OutsideNumber, so that it is a value of the data model.
export function inDataModel(value: DecodedValue): value is Value & DecodedValue {
  if (value instanceof OutsideNumber) return false;
  if (Array.isArray(value)) return value.every(inDataModel);
  if (value instanceof Map) return [...value.values()].every(inDataModel);
  return true;
}
