// Reads a `multipart/form-data` body (HY-57, HY-113): a part whose `Content-Disposition` is `form-data` with a `name`
// and no `filename` is a text field, a part with a `name` and a `filename` is a file, and a part without a name is
// neither. The header lines of a part are separated by CRLF, and blanks are spaces and tabs (HY-113.12, HY-113.13).
import { Fields } from './fields.js';
import { Files } from './files.js';
import { UploadedFile } from './uploaded-file.js';

/** @internal */
export class Multipart {
  // ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
  private static readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private static readonly NAME = /;[ \t]*name="([^"]*)"/i;
  private static readonly FILENAME = /;[ \t]*filename=(?:"([^"]*)"|([^; \t]*))/i;
  // The largest header of a part in bytes (HY-113.16).
  private static readonly HEADER_LIMIT = 8192;

  // Returns the boundary of a `multipart/form-data` content type, or null for another type (HY-113.11).
  static boundary(type: string): string | null {
    if (!/^multipart\/form-data[ \t]*;/i.test(type)) return null;
    const found = /;[ \t]*boundary=(?:"([^"]+)"|([^; \t]+))/i.exec(type);
    return found === null ? null : (found[1] ?? found[2] ?? null);
  }

  // Returns the text fields and the files of the body, or null when a name, a value, a filename or a content type is
  // not UTF-8 (HY-42, HY-113).
  static read(body: Uint8Array, boundary: string): [Fields, Files] | null {
    const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    const delimiter = Buffer.from(`--${boundary}`, 'latin1');
    const names: string[] = [];
    const values = new Map<string, string[]>();
    const fileNames: string[] = [];
    const files = new Map<string, UploadedFile[]>();
    let start = buffer.indexOf(delimiter);
    while (start >= 0) {
      const partStart = start + delimiter.length;
      if (buffer.subarray(partStart, partStart + 2).toString('latin1') === '--') break;
      const next = buffer.indexOf(delimiter, partStart);
      if (next < 0) break;
      const part = buffer.subarray(partStart + 2, next - 2);
      const headerEnd = part.indexOf('\r\n\r\n');
      start = next;
      if ((headerEnd < 0 ? part.length : headerEnd) > Multipart.HEADER_LIMIT) return null;
      if (headerEnd < 0) continue;
      const lines = part.subarray(0, headerEnd).toString('latin1').split('\r\n');
      const content = part.subarray(headerEnd + 4);
      const disposition = Multipart.headerValue(lines, 'content-disposition');
      if (disposition === null || disposition.slice(0, 9).toLowerCase() !== 'form-data') continue;
      const parameters = disposition.slice(9);
      const found = Multipart.NAME.exec(parameters);
      if (found === null) continue;
      const name = Multipart.utf8Text(found[1] ?? '');
      if (name === null) return null;
      const filename = Multipart.FILENAME.exec(parameters);
      if (filename === null) {
        const value = Multipart.utf8Text(content.toString('latin1'));
        if (value === null) return null;
        Multipart.addValue(names, values, name, value);
      } else {
        // A quoted filename keeps its backslashes; a token is the text as it is (HY-113.14).
        const raw = filename[1] ?? filename[2] ?? '';
        const text = Multipart.utf8Text(raw);
        const kind = Multipart.utf8Text(Multipart.headerValue(lines, 'content-type') ?? '');
        if (text === null || kind === null) return null;
        Multipart.addValue(fileNames, files, name, new UploadedFile(name, text, kind, Uint8Array.from(content)));
      }
    }
    return [new Fields(names, values), new Files(fileNames, files)];
  }

  // Returns the value of the first header line of the name, compared without case, without the spaces and tabs around
  // it, or null when no line has the name.
  private static headerValue(lines: readonly string[], name: string): string | null {
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon >= 0 && line.slice(0, colon).toLowerCase() === name) return line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '');
    }
    return null;
  }

  // Returns the UTF-8 text of text whose characters are bytes, or null when the bytes are not UTF-8.
  private static utf8Text(text: string): string | null {
    try {
      return Multipart.decoder.decode(Buffer.from(text, 'latin1'));
    } catch (error) {
      // The fatal decoder fails bytes that are no UTF-8 with a TypeError; any other failure propagates.
      if (error instanceof TypeError) return null;
      throw error;
    }
  }

  // Appends a value to its name, and the name to the names at its first value.
  private static addValue<T>(names: string[], values: Map<string, T[]>, name: string, value: T): void {
    const list = values.get(name);
    if (list === undefined) {
      names.push(name);
      values.set(name, [value]);
    } else {
      list.push(value);
    }
  }
}
