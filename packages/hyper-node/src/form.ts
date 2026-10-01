// Query strings, form bodies and cookies. Query and form fields are read without nesting: each name, in the order
// of its first occurrence, has its values in request order, and a bracketed name is the name as written (HY-56).
// The first cookie of a name counts, as PHP reads $_COOKIE. Names and values must be UTF-8 (HY-42).

const strict = new TextDecoder('utf-8', { fatal: true });

// The fields of a query string or a form body; `valid` is false when a name or a value is not UTF-8.
export interface Fields {
  values: Map<string, string[]>;
  valid: boolean;
}

// Returns the bytes of text whose characters are bytes, as node:http gives request targets and header values.
export function bytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'latin1');
}

// Returns the UTF-8 text of bytes, or null when they are not UTF-8.
export function utf8(bytes: Uint8Array): string | null {
  try {
    return strict.decode(bytes);
  } catch {
    return null;
  }
}

// Decodes `+` to a space and `%XX` to its byte, as PHP urldecode does; any other `%` stays.
export function urlDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '+') {
      bytes.push(0x20);
    } else if (char === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(char.charCodeAt(0) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

// Parses `name=value&name=value`, given as text whose characters are bytes.
export function parseUrlEncoded(text: string): Fields {
  const fields: Fields = { values: new Map(), valid: true };
  for (const pair of text.split('&')) {
    if (pair === '') continue;
    const equals = pair.indexOf('=');
    add(fields, urlDecode(equals < 0 ? pair : pair.slice(0, equals)), urlDecode(equals < 0 ? '' : pair.slice(equals + 1)));
  }
  return fields;
}

// Parses the text fields of a multipart/form-data body; file fields are not form values.
export function parseMultipart(body: Uint8Array, boundary: string): Fields {
  const fields: Fields = { values: new Map(), valid: true };
  const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  let start = buffer.indexOf(delimiter);
  while (start >= 0) {
    const partStart = start + delimiter.length;
    if (buffer.subarray(partStart, partStart + 2).toString('latin1') === '--') break;
    const next = buffer.indexOf(delimiter, partStart);
    if (next < 0) break;
    const part = buffer.subarray(partStart + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const disposition = /^content-disposition:\s*form-data(.*)$/im.exec(part.subarray(0, headerEnd).toString('latin1'))?.[1] ?? '';
      const name = /;\s*name="([^"]*)"/i.exec(disposition)?.[1];
      if (name !== undefined && !/;\s*filename=/i.test(disposition)) add(fields, bytesOf(name), part.subarray(headerEnd + 4));
    }
    start = next;
  }
  return fields;
}

function add(fields: Fields, nameBytes: Uint8Array, valueBytes: Uint8Array): void {
  const name = utf8(nameBytes);
  const value = utf8(valueBytes);
  if (name === null || value === null) {
    fields.valid = false;
    return;
  }
  const values = fields.values.get(name);
  if (values === undefined) fields.values.set(name, [value]);
  else values.push(value);
}

// Parses a Cookie header. Values are URL-decoded; a cookie that is not UTF-8 is ignored, because hyper does not
// check cookies (HY-42).
export function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    const name = utf8(urlDecode(pair.slice(0, equals).trimStart()));
    const value = utf8(urlDecode(pair.slice(equals + 1)));
    if (name !== null && value !== null && name !== '' && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}
