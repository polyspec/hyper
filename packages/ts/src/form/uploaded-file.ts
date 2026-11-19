// A file that a request sent in a file part of a multipart/form-data body (HY-113): its name, its filename, its content
// type, which is empty text when the part has none, and its bytes, as the part sent them. It holds a file of the core,
// `FormFile` (form_file), whose bytes are a value or a file in the directory of the request for a body that the server
// read in chunks (HY-131, F-11, F-22); its read and move wait on the file system, so `content` and `moveTo` give a promise.
import { ArgumentCountError } from '../app/argument-count-error.js';
import { binding, type CoreUploadedFile } from '../app/core-rules.js';

export class UploadedFile {
  private core: CoreUploadedFile;

  constructor(name: string, filename: string, contentType: string, content: Uint8Array) {
    ArgumentCountError.between(arguments.length, 4, 4);
    // form_file.new gives a file of the core that holds its bytes as a value (F-22, HY-113.21).
    this.core = new (binding().FormFile)(name, filename, contentType, content);
  }

  /**
   * Returns the file of a file of the core, which the body read in chunks or held as one value (HY-131.28, F-22).
   *
   * @internal
   */
  static ofCore(file: CoreUploadedFile): UploadedFile {
    const made: unknown = Object.create(UploadedFile.prototype);
    if (!(made instanceof UploadedFile)) {
      throw new TypeError('Object.create of the prototype of UploadedFile gave no UploadedFile');
    }
    made.core = file;
    return made;
  }

  // Returns the name of the part, the `name` parameter of its Content-Disposition.
  name(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.core.name;
  }

  // Returns the filename parameter of the part, as it was sent (HY-113.21).
  filename(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.core.filename;
  }

  // Returns the Content-Type header of the part as it was sent, or the empty text when it has none.
  contentType(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.core.contentType;
  }

  // Returns the number of bytes of the part (HY-131.28).
  size(): number {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.core.size;
  }

  // Returns the bytes of the part as one value, and fails with the kind `moved` or `removed` of http-form (HY-131.28, HY-131.34,
  // F-11).
  async content(): Promise<Uint8Array> {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.core.content();
  }

  // Moves the file to the path through the core, which fails with the kind `exists` when the path exists and with
  // `moved` when the file was moved (HY-131.28, HY-131.34, F-11).
  async moveTo(path: string): Promise<void> {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (typeof path !== 'string') throw new TypeError('a path is not a string (HY-131)');
    await this.core.moveTo(path);
  }
}
