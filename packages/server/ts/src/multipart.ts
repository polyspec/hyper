// Reads the parts of a `multipart/form-data` body (HY-57, HY-113): a part whose `Content-Disposition` is `form-data`
// with a `name` and no `filename` is a text field, a part with a `name` and a `filename` is a file, and another part
// is neither.
import { Fields } from './fields.js';
import { Files } from './files.js';
import { MultipartReader } from './multipart-reader.js';
import { UploadedFile } from './uploaded-file.js';

/** @internal */
export class Multipart extends MultipartReader {
  // ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
  private static readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private readonly names: string[];
  private readonly values: Map<string, string[]>;
  private readonly fileNames: string[];
  private readonly files: Map<string, UploadedFile[]>;
  // The name of the part that is read, or null for a part that is neither a value nor a file (HY-113.6).
  private name: string | null;
  // The filename and the content type of the file part that is read, or null for a text field.
  private file: [string, string] | null;
  private content: Uint8Array[];

  constructor(boundary: string) {
    super(boundary);
    this.names = [];
    this.values = new Map();
    this.fileNames = [];
    this.files = new Map();
    this.name = null;
    this.file = null;
    this.content = [];
  }

  // Returns the boundary of a `multipart/form-data` content type, or null for another type (HY-113.11).
  static boundary(type: string): string | null {
    const [kind, parameters] = Multipart.headerParameters(type);
    const boundary = parameters.get('boundary');
    return kind !== 'multipart/form-data' || boundary === undefined || boundary === '' ? null : boundary;
  }

  // Returns the text fields and the files of the body, or null when the body fails with HY-42 (HY-113, HY-131).
  static read(body: Uint8Array, boundary: string): [Fields, Files] | null {
    const reader = new Multipart(boundary);
    return reader.feed(body) ? reader.result() : null;
  }

  // Returns the text fields and the files that were read, or null for a body that failed or has not ended (HY-131.5).
  result(): [Fields, Files] | null {
    return this.closed() ? [new Fields(this.names, this.values), new Files(this.fileNames, this.files)] : null;
  }

  partStarted(lines: string[]): boolean {
    this.name = null;
    this.file = null;
    this.content = [];
    const disposition = Multipart.headerValue(lines, 'content-disposition');
    if (disposition === null) return true;
    const [kind, parameters] = Multipart.headerParameters(disposition);
    const name = parameters.get('name');
    if (kind !== 'form-data' || name === undefined) return true;
    const filename = parameters.get('filename');
    if (filename !== undefined) {
      const text = Multipart.utf8Text(filename);
      const type = Multipart.utf8Text(Multipart.headerValue(lines, 'content-type') ?? '');
      if (text === null || type === null) return false;
      this.file = [text, type];
    }
    this.name = Multipart.utf8Text(name);
    return this.name !== null;
  }

  partData(bytes: Uint8Array): boolean {
    if (this.name !== null) this.content.push(Uint8Array.from(bytes));
    return true;
  }

  partEnded(): boolean {
    if (this.name === null) return true;
    const content = Buffer.concat(this.content);
    this.content = [];
    if (this.file === null) {
      const value = Multipart.utf8Text(content.toString('latin1'));
      if (value === null) return false;
      Multipart.addValue(this.names, this.values, this.name, value);
    } else {
      Multipart.addValue(this.fileNames, this.files, this.name, new UploadedFile(this.name, this.file[0], this.file[1], Uint8Array.from(content)));
    }
    return true;
  }

  // Returns the text before the first `;` without the spaces and tabs around it, in lower case, and the parameters
  // after it by their names in lower case: each follows a `;` and spaces or tabs, its value is a quoted string
  // without its quotes or the text up to the next `;`, space or tab, and the first parameter of a name counts
  // (HY-113.13).
  private static headerParameters(text: string): [string, Map<string, string>] {
    const parameters = new Map<string, string>();
    let index = text.indexOf(';');
    const kind = (index < 0 ? text : text.slice(0, index)).replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
    while (index >= 0) {
      index += 1;
      while (text.charAt(index) === ' ' || text.charAt(index) === '\t') index += 1;
      const start = index;
      while (index < text.length && text.charAt(index) !== '=' && text.charAt(index) !== ';') index += 1;
      if (text.charAt(index) !== '=') {
        index = index < text.length ? index : -1;
        continue;
      }
      const name = text.slice(start, index).toLowerCase();
      index += 1;
      let value: string;
      if (text.charAt(index) === '"') {
        const close = text.indexOf('"', index + 1);
        value = text.slice(index + 1, close < 0 ? text.length : close);
        index = close < 0 ? text.length : close + 1;
      } else {
        const from = index;
        while (index < text.length && text.charAt(index) !== ';' && text.charAt(index) !== ' ' && text.charAt(index) !== '\t') index += 1;
        value = text.slice(from, index);
      }
      if (!parameters.has(name)) parameters.set(name, value);
      index = text.indexOf(';', index);
    }
    return [kind, parameters];
  }

  // Returns the value of the first header line of the name, compared without case, without the spaces and tabs around
  // it, or null when no line has the name (HY-113.12).
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
