// The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request order
// (HY-113).
import { Multipart } from './multipart.js';
import { NamedValues } from './named-values.js';
import type { UploadedFile } from './uploaded-file.js';

/** @internal */
export class Files extends NamedValues<UploadedFile> {
  // Returns files without names.
  static empty(): Files {
    return new Files([], new Map());
  }

  // Returns the files of a `multipart/form-data` body, and none for another body type. Returns null when a part of the
  // body fails with HY-42 (HY-113.15).
  static fromBody(type: string, body: Uint8Array): Files | null {
    const boundary = Multipart.boundary(type);
    if (boundary === null) return Files.empty();
    return Multipart.read(body, boundary)?.[1] ?? null;
  }

  // Returns the size in bytes of the largest file, or 0 when there is none (HY-114).
  largest(): number {
    return Math.max(0, ...this.pairs().flatMap(([, files]) => files.map((file) => file.content().byteLength)));
  }
}
