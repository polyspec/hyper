// The cookies of a request: one parse of its Cookie header (HY-129), the same in every server. The header is text whose
// characters U+0000 to U+00FF are its bytes, as node:http gives it, and the names and values are decoded as UTF-8
// (HY-42).

// ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** @internal */
export class Cookies {
  // Returns the cookies of a Cookie header, or none for a request without the header. The header splits at each `;`,
  // spaces and tabs at both ends of a pair are removed, and a pair splits at its first `=`. A pair gives no cookie when
  // it has no `=`, an empty name, a name that is not UTF-8 (the name is not decoded), or a value that is not UTF-8 after
  // percent-decoding. Of the pairs that give a cookie, the first of a name counts.
  static parse(header: string | null): Map<string, string> {
    const cookies = new Map<string, string>();
    if (header === null) return cookies;
    for (const part of header.split(';')) {
      const pair = part.replace(/^[ \t]+/u, '').replace(/[ \t]+$/u, '');
      const equals = pair.indexOf('=');
      if (equals < 0) continue;
      const name = Cookies.utf8(pair.slice(0, equals));
      const value = Cookies.utf8(Cookies.percentDecode(pair.slice(equals + 1)));
      if (name !== null && name !== '' && value !== null && !cookies.has(name)) cookies.set(name, value);
    }
    return cookies;
  }

  // Replaces each `%` with two hexadecimal digits by its byte; every other byte, `+` included, is kept.
  private static percentDecode(bytes: string): string {
    return bytes.replace(/%([0-9A-Fa-f]{2})/gu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }

  // Returns the bytes as UTF-8 text, or null when they are not UTF-8. Each character of `bytes` is one byte.
  private static utf8(bytes: string): string | null {
    const data = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      const code = bytes.charCodeAt(index);
      if (code > 0xff) return null;
      data[index] = code;
    }
    try {
      return strict.decode(data);
    } catch {
      return null;
    }
  }
}
