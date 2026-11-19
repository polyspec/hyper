// The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request order
// (HY-113).
import { NamedValues } from './named-values.js';
import type { UploadedFile } from './uploaded-file.js';

/** @internal */
export class Files extends NamedValues<UploadedFile> {
  // Returns files without names.
  static empty(): Files {
    return new Files([], new Map());
  }

  // Returns the size in bytes of each file, in the order of the pairs (HY-114).
  sizes(): number[] {
    return this.pairs().flatMap(([, files]) => files.map((file) => file.size()));
  }
}
