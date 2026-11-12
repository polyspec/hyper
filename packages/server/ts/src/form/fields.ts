// The values of a query or a form, without nesting: each name, in the order of its first occurrence, with its values in
// request order; a bracketed name is the name as written (HY-56, HY-57).
import { Multipart } from './multipart.js';
import { NamedValues } from './named-values.js';

/** @internal */
export class Fields extends NamedValues<string> {
  // ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
  private static readonly utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  // Returns fields without names.
  static empty(): Fields {
    return new Fields([], new Map());
  }

  // Parses `name=value&name=value`: `+` is a space, `%XX` is its byte and another `%` stays. Returns null when a name
  // or a value is not UTF-8 (HY-42, HY-56).
  static parse(text: Uint8Array): Fields | null {
    const names: string[] = [];
    const values = new Map<string, string[]>();
    for (const part of Buffer.from(text.buffer, text.byteOffset, text.byteLength).toString('latin1').split('&')) {
      if (part === '') continue;
      const equals = part.indexOf('=');
      const name = Fields.percentDecoded(equals < 0 ? part : part.slice(0, equals));
      const value = Fields.percentDecoded(equals < 0 ? '' : part.slice(equals + 1));
      if (name === null || value === null) return null;
      const list = values.get(name);
      if (list === undefined) {
        names.push(name);
        values.set(name, [value]);
      } else {
        list.push(value);
      }
    }
    return new Fields(names, values);
  }

  // Returns the fields of a request body: of an `application/x-www-form-urlencoded` body, or the text fields of a
  // `multipart/form-data` body; a body of another type has none (HY-57). Returns null when a part of the body fails
  // with HY-42 (HY-113.15).
  static fromBody(type: string, body: Uint8Array): Fields | null {
    if (/^application\/x-www-form-urlencoded[ \t]*(?:;|$)/i.test(type)) return Fields.parse(body);
    const boundary = Multipart.boundary(type);
    if (boundary === null) return Fields.empty();
    return Multipart.read(body, boundary)?.[0] ?? null;
  }

  // Decodes `+` to a space and `%XX` to its byte, as PHP urldecode does, in text whose characters are bytes, and the
  // bytes as UTF-8, or null when they are not UTF-8.
  private static percentDecoded(text: string): string | null {
    const bytes: number[] = [];
    for (let index = 0; index < text.length; index++) {
      const char = text.charAt(index);
      if (char === '+') {
        bytes.push(0x20);
      } else if (char === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
        bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(char.charCodeAt(0) & 0xff);
      }
    }
    try {
      return Fields.utf8.decode(Uint8Array.from(bytes));
    } catch (error) {
      // The fatal decoder fails bytes that are no UTF-8 with a TypeError; any other failure propagates.
      if (error instanceof TypeError) return null;
      throw error;
    }
  }
}
