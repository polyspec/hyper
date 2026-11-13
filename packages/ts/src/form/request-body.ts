// The body of a request as its host reads it (HY-59, HY-131): the bytes of a body that is one value, or the parts of
// a `multipart/form-data` body that is read in chunks, whose files are in a directory of the request.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fields } from './fields.js';
import type { Files } from './files.js';
import { Multipart } from './multipart.js';

/** @internal */
export class RequestBody {
  private readonly limit: number;
  private readonly multipart: Multipart | null;
  private readonly files: string | null;
  private chunks: Uint8Array[];
  private length: number;
  private readonly valueLimit: number;
  private over: boolean;

  // Starts the body of the content type with the body limit; `stream` tells whether a multipart body is read in
  // chunks, which it is when `multipart/form-data` is a form type of the application (HY-131.1).
  // The value limit bounds a body that is one value and the text values of a body read in chunks, the part limit
  // its parts and the file limit each of its files (HY-131.7 to HY-131.12).
  constructor(type: string, limit: number, stream: boolean, valueLimit: number, partLimit: number, fileLimit: number) {
    const boundary = stream ? Multipart.boundary(type) : null;
    this.limit = limit;
    this.files = boundary === null ? null : RequestBody.createdDirectory();
    this.multipart = boundary === null ? null : new Multipart(boundary, this.files, valueLimit, partLimit, fileLimit);
    this.valueLimit = valueLimit;
    this.over = false;
    this.chunks = [];
    this.length = 0;
  }

  // Reads the next chunk, and returns false when the body passed a limit, after which it holds no bytes (HY-59.4,
  // HY-131.11).
  feed(chunk: Uint8Array): boolean {
    if (this.over) return false;
    this.length += chunk.byteLength;
    if (this.length > this.limit || (this.multipart === null && this.length > this.valueLimit)) return this.bodyPassed();
    if (this.multipart === null) this.chunks.push(Uint8Array.from(chunk));
    else if (!this.multipart.feed(chunk) && this.multipart.exceeded()) return this.bodyPassed();
    return true;
  }

  // Returns true when the body passed the body limit, the value limit, the part limit or the file limit (HY-131.11).
  exceeded(): boolean {
    return this.over;
  }

  // Records that the body passed a limit and drops what it holds.
  private bodyPassed(): boolean {
    this.over = true;
    this.chunks = [];
    this.multipart?.release();
    return false;
  }

  // Returns the number of bytes that were read.
  size(): number {
    return this.length;
  }

  // Returns the body as one value: no bytes for a body read in chunks and for a body that passed the limit.
  held(): Uint8Array {
    return Buffer.concat(this.chunks);
  }

  // Returns true when the body is read in chunks.
  streamed(): boolean {
    return this.multipart !== null;
  }

  // Returns the text fields and the files of a body read in chunks, or null when it failed, has not ended or passed
  // the limit (HY-131.5).
  parts(): [Fields, Files] | null {
    return this.multipart === null || this.over ? null : this.multipart.result();
  }

  // Returns the directory of the files of the body, or null for a body that is one value.
  directory(): string | null {
    return this.files;
  }

  // Resolves when the bytes given to the files are written (HY-131.21).
  async written(): Promise<void> {
    await this.multipart?.written();
  }

  // Creates a directory below the temporary directory of the system for the user of the server only.
  private static createdDirectory(): string {
    return mkdtempSync(join(tmpdir(), 'hyper-'));
  }

  // Removes the directory of the files with the files that were not moved, after the files are closed (HY-131.14,
  // HY-131.21).
  async remove(): Promise<void> {
    this.multipart?.release();
    await this.multipart?.settled();
    if (this.files !== null) rmSync(this.files, { recursive: true, force: true });
  }
}
