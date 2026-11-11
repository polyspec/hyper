// A file that a request sent in a file part of a multipart/form-data body (HY-113): its name, its filename, its content
// type, which is empty text when the part has none, and its bytes, as the part sent them.
export class UploadedFile {
  private readonly fileName: string;
  private readonly partName: string;
  private readonly type: string;
  private readonly bytes: Uint8Array;

  constructor(name: string, filename: string, contentType: string, content: Uint8Array) {
    this.partName = name;
    this.fileName = filename;
    this.type = contentType;
    this.bytes = content;
  }

  // Returns the name of the part, the `name` parameter of its Content-Disposition.
  name(): string {
    return this.partName;
  }

  // Returns the filename parameter of the part, with the escapes of its quoted string undone.
  filename(): string {
    return this.fileName;
  }

  // Returns the Content-Type header of the part as it was sent, or the empty text when it has none.
  contentType(): string {
    return this.type;
  }

  // Returns the bytes of the part.
  content(): Uint8Array {
    return this.bytes;
  }
}
