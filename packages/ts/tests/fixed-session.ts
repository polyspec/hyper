// The session of the record tests, whose record is fixed bytes (HY-104.13, HY-104.48).
import { RecordSession } from '../src/session/record-session.js';

/** A session whose record is the given bytes, as a store of a request gives it. */
export class FixedSession extends RecordSession {
  private readonly record: Uint8Array;

  constructor(record: Uint8Array) {
    super('a'.repeat(32));
    this.record = record;
  }

  override stored(): Uint8Array {
    return this.record;
  }

  async close(): Promise<void> {}
}

/** The bytes of a text whose characters are the byte values 0 to 255. */
export const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
