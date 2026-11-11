// The state machine that reads a `multipart/form-data` body in chunks (HY-131): it finds the delimiters, gives the
// header lines and the content of each part to the reader that extends it, and holds besides one chunk at most the
// delimiter or the header lines of one part.

/** @internal */
export abstract class MultipartReader {
  // The largest header of a part in bytes (HY-113.16).
  private static readonly HEADER_LIMIT = 8192;
  // `--` and the boundary, and the same after the CRLF that ends the content of a part (HY-131.2, HY-131.3).
  private readonly delimiter: Buffer;
  private readonly separator: Buffer;
  private buffer: Buffer = Buffer.alloc(0);
  private state: 'preamble' | 'delimiter' | 'headers' | 'content' | 'done' | 'failed' = 'preamble';
  // True until the body is known not to start with the delimiter.
  private first = true;

  constructor(boundary: string) {
    this.delimiter = Buffer.from(`--${boundary}`, 'latin1');
    this.separator = Buffer.from(`\r\n--${boundary}`, 'latin1');
  }

  // Reads the next chunk of the body, and returns false when the body failed (HY-131.5).
  feed(chunk: Uint8Array): boolean {
    if (this.state === 'failed') return false;
    if (this.state === 'done') return true;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.advance());
    // advance changes the state, which the narrowing above does not see.
    const state: string = this.state;
    return state !== 'failed';
  }

  // Returns true when the body ended with the `--` after a delimiter (HY-131.4).
  closed(): boolean {
    return this.state === 'done';
  }

  // Returns the number of bytes that the reader holds between two chunks.
  buffered(): number {
    return this.buffer.length;
  }

  // Receives the header lines of a part, and returns false to fail the body.
  abstract partStarted(lines: string[]): boolean;

  // Receives the next bytes of the content of the part, and returns false to fail the body.
  abstract partData(bytes: Uint8Array): boolean;

  // Receives the end of the part, and returns false to fail the body.
  abstract partEnded(): boolean;

  // Takes one step of the state machine, and returns false when it needs another chunk or has ended.
  private advance(): boolean {
    const buffer = this.buffer;
    if (this.state === 'preamble') {
      if (this.first) {
        if (buffer.length < this.delimiter.length) {
          if (this.delimiter.subarray(0, buffer.length).equals(buffer)) return false;
        } else if (buffer.subarray(0, this.delimiter.length).equals(this.delimiter)) {
          this.first = false;
          return this.next('delimiter', this.delimiter.length);
        }
        this.first = false;
      }
      const index = buffer.indexOf(this.separator);
      if (index >= 0) return this.next('delimiter', index + this.separator.length);
      this.buffer = buffer.subarray(buffer.length - Math.min(buffer.length, this.separator.length - 1));
      return false;
    }
    if (this.state === 'delimiter') {
      if (buffer.length < 2) return false;
      const after = buffer.toString('latin1', 0, 2);
      if (after === '--') {
        this.buffer = Buffer.alloc(0);
        this.state = 'done';
        return false;
      }
      return after === '\r\n' ? this.next('headers', 2) : this.fail();
    }
    if (this.state === 'headers') {
      if (buffer.length < 2) return false;
      const empty = buffer.toString('latin1', 0, 2) === '\r\n';
      const end = empty ? 0 : buffer.indexOf('\r\n\r\n');
      if (end < 0) return buffer.length >= MultipartReader.HEADER_LIMIT + 4 ? this.fail() : false;
      if (end > MultipartReader.HEADER_LIMIT) return this.fail();
      const lines = empty ? [] : buffer.toString('latin1', 0, end).split('\r\n');
      const delimiter = this.delimiter.toString('latin1');
      if (lines.some((line) => line.startsWith(delimiter))) return this.fail();
      this.next('content', empty ? 2 : end + 4);
      return this.partStarted(lines) || this.fail();
    }
    if (this.state === 'content') {
      const index = buffer.indexOf(this.separator);
      if (index >= 0) {
        if (index > 0 && !this.partData(buffer.subarray(0, index))) return this.fail();
        if (!this.partEnded()) return this.fail();
        return this.next('delimiter', index + this.separator.length);
      }
      const keep = Math.min(buffer.length, this.separator.length - 1);
      if (buffer.length > keep && !this.partData(buffer.subarray(0, buffer.length - keep))) return this.fail();
      this.buffer = buffer.subarray(buffer.length - keep);
      return false;
    }
    return false;
  }

  // Drops the bytes that were read and enters the state.
  private next(state: 'delimiter' | 'headers' | 'content', read: number): boolean {
    this.buffer = this.buffer.subarray(read);
    this.state = state;
    return true;
  }

  private fail(): boolean {
    this.buffer = Buffer.alloc(0);
    this.state = 'failed';
    return false;
  }
}
