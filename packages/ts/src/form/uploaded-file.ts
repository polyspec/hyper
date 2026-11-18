// A file that a request sent in a file part of a multipart/form-data body (HY-113): its name, its filename, its content
// type, which is empty text when the part has none, and its bytes, as the part sent them. The bytes are a value, or a
// file of the core in the directory of the request for a body that the server read in chunks (HY-131, F-11), whose
// read and move wait on the file system, so `content` and `moveTo` give a promise.
import { closeSync, openSync, writeSync } from 'node:fs';
import { ArgumentCountError } from '../app/argument-count-error.js';
import type { CoreUploadedFile } from '../app/core-rules.js';

export class UploadedFile {
  private readonly fileName: string;
  private readonly partName: string;
  private readonly type: string;
  private bytes: Uint8Array | null;
  private core: CoreUploadedFile | null;
  private length: number;
  private moved: boolean;

  constructor(name: string, filename: string, contentType: string, content: Uint8Array) {
    ArgumentCountError.between(arguments.length, 4, 4);
    this.partName = name;
    this.fileName = filename;
    this.type = contentType;
    this.bytes = content;
    this.core = null;
    this.length = content.byteLength;
    this.moved = false;
  }

  /**
   * Returns the file of a file of the core, which the body read in chunks or held as one value (HY-131.13, F-22).
   *
   * @internal
   */
  static ofCore(file: CoreUploadedFile): UploadedFile {
    const made = new UploadedFile(file.name, file.filename, file.contentType, new Uint8Array());
    made.bytes = null;
    made.core = file;
    made.length = file.size;
    return made;
  }

  // Returns the name of the part, the `name` parameter of its Content-Disposition.
  name(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.partName;
  }

  // Returns the filename parameter of the part, as it was sent (HY-113.14).
  filename(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.fileName;
  }

  // Returns the Content-Type header of the part as it was sent, or the empty text when it has none.
  contentType(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.type;
  }

  // Returns the number of bytes of the part (HY-131.15).
  size(): number {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.length;
  }

  // Returns the bytes of the part as one value, and fails after a move (HY-131.16); a file of the core fails with the
  // kind `moved` or `removed` of http-form (F-11).
  async content(): Promise<Uint8Array> {
    ArgumentCountError.between(arguments.length, 0, 0);
    if (this.core !== null) return this.core.content();
    if (this.moved || this.bytes === null) throw new RangeError('the file was moved (HY-131)');
    return this.bytes;
  }

  // Moves the file to the path, and fails when the path exists or when the file was moved (HY-131.15, HY-131.16); a
  // file of the core is moved by the core (F-11).
  async moveTo(path: string): Promise<void> {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (typeof path !== 'string') throw new TypeError('a path is not a string (HY-131)');
    if (this.core !== null) {
      await this.core.moveTo(path);
      return;
    }
    if (this.moved) throw new RangeError('the file was moved (HY-131)');
    let target: number;
    try {
      target = openSync(path, 'wx', 0o600);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new RangeError('the path exists (HY-131)');
      throw error;
    }
    try {
      writeSync(target, this.bytes ?? new Uint8Array());
    } finally {
      closeSync(target);
    }
    this.bytes = null;
    this.moved = true;
  }
}
