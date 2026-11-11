// A file that a request sent in a file part of a multipart/form-data body (HY-113): its name, its filename, its content
// type, which is empty text when the part has none, and its bytes, as the part sent them. The bytes are a value, or a
// temporary file of the request for a body that the server read in chunks (HY-131).
import { closeSync, copyFileSync, constants, linkSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { errorCode } from './error-code.js';

export class UploadedFile {
  private readonly fileName: string;
  private readonly partName: string;
  private readonly type: string;
  private bytes: Uint8Array | null;
  private path: string | null;
  private length: number;
  private moved: boolean;

  constructor(name: string, filename: string, contentType: string, content: Uint8Array) {
    this.partName = name;
    this.fileName = filename;
    this.type = contentType;
    this.bytes = content;
    this.path = null;
    this.length = content.byteLength;
    this.moved = false;
  }

  /**
   * Returns a file whose bytes are the file of the path, of the size in bytes (HY-131.13).
   *
   * @internal
   */
  static stored(name: string, filename: string, contentType: string, path: string, size: number): UploadedFile {
    const file = new UploadedFile(name, filename, contentType, new Uint8Array());
    file.bytes = null;
    file.path = path;
    file.length = size;
    return file;
  }

  // Returns the name of the part, the `name` parameter of its Content-Disposition.
  name(): string {
    return this.partName;
  }

  // Returns the filename parameter of the part, as it was sent (HY-113.14).
  filename(): string {
    return this.fileName;
  }

  // Returns the Content-Type header of the part as it was sent, or the empty text when it has none.
  contentType(): string {
    return this.type;
  }

  // Returns the number of bytes of the part (HY-131.15).
  size(): number {
    return this.length;
  }

  // Returns the bytes of the part as one value, and fails after a move (HY-131.16).
  content(): Uint8Array {
    if (this.moved) throw new RangeError('the file was moved (HY-131)');
    if (this.bytes !== null) return this.bytes;
    if (this.path === null) throw new Error('hyper: a stored file has no path');
    return Uint8Array.from(readFileSync(this.path));
  }

  // Moves the file to the path, and fails when the path exists or when the file was moved (HY-131.15, HY-131.16).
  moveTo(path: string): void {
    if (typeof path !== 'string') throw new TypeError('a path is not a string (HY-131)');
    if (this.moved) throw new RangeError('the file was moved (HY-131)');
    if (this.path === null) {
      const target = UploadedFile.createdFile(path);
      try {
        writeSync(target, this.bytes ?? new Uint8Array());
      } finally {
        closeSync(target);
      }
    } else {
      UploadedFile.linkedFile(this.path, path);
      unlinkSync(this.path);
    }
    this.bytes = null;
    this.moved = true;
  }

  // Opens a new file at the path for writing, and fails when the path exists.
  private static createdFile(path: string): number {
    try {
      return openSync(path, 'wx', 0o600);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw new RangeError('the path exists (HY-131)');
      throw error;
    }
  }

  // Gives the file of the source the path as a second name, or copies it there when the file system gives no second
  // name, as between two file systems; fails when the path exists.
  private static linkedFile(source: string, path: string): void {
    try {
      linkSync(source, path);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw new RangeError('the path exists (HY-131)');
      try {
        copyFileSync(source, path, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (errorCode(copyError) === 'EEXIST') throw new RangeError('the path exists (HY-131)');
        throw copyError;
      }
    }
  }
}
