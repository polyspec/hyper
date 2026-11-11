// The parse of a Cookie header (HY-129). The header is text whose characters U+0000 to U+00FF are its bytes, as node:http
// gives it, and the names and values are decoded as UTF-8 (HY-42).

const strict = new TextDecoder('utf-8', { fatal: true });

// Returns the bytes of text whose characters are bytes; a character above U+00FF fails, because it has no byte.
function bytesOf(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) throw new RangeError(`hyper: cookie text has the character U+${code.toString(16).toUpperCase()} outside U+0000 to U+00FF`);
    bytes[index] = code;
  }
  return bytes;
}

// Returns the text of UTF-8 bytes, or null for bytes that are not UTF-8.
function utf8(bytes: Uint8Array): string | null {
  try {
    return strict.decode(bytes);
  } catch {
    return null;
  }
}

// Parses a Cookie header into a map from name to value, in the order of the first pair of each name (HY-129). A pair
// gives no cookie when it has no `=`, an empty name, a name that is not UTF-8, or a value that is not UTF-8 after
// percent-decoding; the first pair of a name that gives a cookie counts. A request without the header has no cookies.
/** @internal */
export function parse(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const pair of header.split(';')) {
    const trimmed = pair.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    const equals = trimmed.indexOf('=');
    // No `=` (-1) or an empty name (0) gives no cookie.
    if (equals <= 0) continue;
    const name = utf8(bytesOf(trimmed.slice(0, equals)));
    const value = utf8(bytesOf(trimmed.slice(equals + 1).replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))));
    if (name === null || value === null || cookies.has(name)) continue;
    cookies.set(name, value);
  }
  return cookies;
}
