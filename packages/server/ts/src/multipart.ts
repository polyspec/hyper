// Reads the parts of a `multipart/form-data` body (HY-57, HY-113): a part whose `Content-Disposition` is `form-data`
// with a `name` and no `filename` is a text field, a part with a `name` and a `filename` is a file, and another part
// is neither.
import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
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
  // The directory of the files of the body, or null for files that are values (HY-131.13).
  private readonly directory: string | null;
  // The file that the content of the file part is written to, with its path and the bytes given to it.
  private target: WriteStream | null;
  private path: string;
  private size: number;
  private stored: number;
  // The largest bytes of the names and contents of the text values together, the largest number of parts and the
  // largest bytes of one file, each null for no limit (HY-131.7 to HY-131.12), with what was read of each.
  private readonly valueLimit: number | null;
  private readonly partLimit: number | null;
  private readonly fileLimit: number | null;
  private valueBytes: number;
  private partCount: number;
  private over: boolean;
  // The files whose last bytes are not written yet, and the first error of a write.
  private finishing: Promise<void>[];
  private failure: Error | null;

  constructor(boundary: string, directory: string | null, valueLimit: number | null, partLimit: number | null, fileLimit: number | null) {
    super(boundary);
    this.directory = directory;
    this.target = null;
    this.path = '';
    this.size = 0;
    this.stored = 0;
    this.valueLimit = valueLimit;
    this.partLimit = partLimit;
    this.fileLimit = fileLimit;
    this.valueBytes = 0;
    this.partCount = 0;
    this.over = false;
    this.finishing = [];
    this.failure = null;
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
    const reader = new Multipart(boundary, null, null, null, null);
    return reader.feed(body) ? reader.result() : null;
  }

  // Returns the text fields and the files that were read, or null for a body that failed or has not ended (HY-131.5).
  result(): [Fields, Files] | null {
    return this.closed() ? [new Fields(this.names, this.values), new Files(this.fileNames, this.files)] : null;
  }

  // Returns true when the body passed the value limit, the part limit or the file limit (HY-131.11).
  exceeded(): boolean {
    return this.over;
  }

  // Returns the number of parts that were read, also those that are neither a value nor a file (HY-131.12).
  count(): number {
    return this.partCount;
  }

  partStarted(lines: string[]): boolean {
    this.name = null;
    this.file = null;
    this.content = [];
    this.partCount += 1;
    if (this.partLimit !== null && this.partCount > this.partLimit) return this.limitPassed();
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
    if (this.name === null) return false;
    this.size = 0;
    if (this.file === null) {
      // The name counts as its bytes were sent.
      this.valueBytes += name.length;
      if (this.valueLimit !== null && this.valueBytes > this.valueLimit) return this.limitPassed();
    }
    if (this.file !== null && this.directory !== null) {
      this.stored += 1;
      this.path = join(this.directory, String(this.stored));
      // The flag wx fails for a path that exists, and the mode gives the file to the user of the server only.
      this.target = createWriteStream(this.path, { flags: 'wx', mode: 0o600 });
      this.target.on('error', (error) => {
        this.failure ??= error;
      });
    }
    return true;
  }

  partData(bytes: Uint8Array): boolean {
    if (this.name === null) return true;
    if (this.file === null) {
      this.valueBytes += bytes.byteLength;
      if (this.valueLimit !== null && this.valueBytes > this.valueLimit) return this.limitPassed();
    } else {
      this.size += bytes.byteLength;
      if (this.fileLimit !== null && this.size > this.fileLimit) return this.limitPassed();
    }
    if (this.target === null) this.content.push(Uint8Array.from(bytes));
    else this.target.write(bytes);
    return true;
  }

  // Resolves when the bytes given to the files are written, after the stream of a file emptied its buffer; rejects
  // with the first error of a write (HY-131.21).
  async written(): Promise<void> {
    const target = this.target;
    if (target?.writableNeedDrain === true) {
      await new Promise<void>((resolve) => {
        // Both listeners leave the stream with the first event, so that a long file does not collect them.
        const settle = (): void => {
          target.off('drain', settle);
          target.off('error', settle);
          resolve();
        };
        target.on('drain', settle);
        target.on('error', settle);
      });
    }
    const finishing = this.finishing;
    this.finishing = [];
    await Promise.all(finishing);
    if (this.failure !== null) throw this.failure;
  }

  // Records that the body passed a limit, and fails the body.
  private limitPassed(): boolean {
    this.over = true;
    this.content = [];
    return false;
  }

  // Closes the file of a part whose end was not read.
  release(): void {
    this.target?.destroy();
    this.target = null;
  }

  partEnded(): boolean {
    if (this.name === null) return true;
    const content = Buffer.concat(this.content);
    this.content = [];
    if (this.file === null) {
      const value = Multipart.utf8Text(content.toString('latin1'));
      if (value === null) return false;
      Multipart.addValue(this.names, this.values, this.name, value);
    } else if (this.target === null) {
      Multipart.addValue(this.fileNames, this.files, this.name, new UploadedFile(this.name, this.file[0], this.file[1], Uint8Array.from(content)));
    } else {
      const target = this.target;
      this.target = null;
      this.finishing.push(
        new Promise<void>((resolve) => {
          const settle = (): void => {
            target.off('finish', settle);
            target.off('error', settle);
            resolve();
          };
          target.on('finish', settle);
          target.on('error', settle);
        }),
      );
      target.end();
      Multipart.addValue(this.fileNames, this.files, this.name, UploadedFile.stored(this.name, this.file[0], this.file[1], this.path, this.size));
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
