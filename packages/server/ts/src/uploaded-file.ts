// A file that a request sent in a file part of a multipart/form-data body (HY-113): its name, its filename, its content
// type, which is empty text when the part has none, and its bytes, as the part sent them.
export class UploadedFile {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;

  constructor(name: string, filename: string, contentType: string, content: Uint8Array) {
    this.name = name;
    this.filename = filename;
    this.contentType = contentType;
    this.content = content;
  }
}
