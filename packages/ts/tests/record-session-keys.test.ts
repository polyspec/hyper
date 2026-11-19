// The session record of a key that is no array key (HY-104.13): a Node server reads a record as the data model, and a
// record whose key is no array key fails the request with the message of the record.
import { describe, expect, it } from 'vitest';
import { RecordSession } from '../src/session/record-session.js';

/** A session whose record is the given bytes, as a store of a request gives it. */
class FixedSession extends RecordSession {
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

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('the session record of a key that is no array key (HY-104.13)', () => {
  it('refuses a record whose key is a float, which is no array key, with the message of the codec of the record', () => {
    // serialize-form bytes of a map with the float key 1.5: a PHP array key is an integer or a text, so the codec of the
    // record refuses the key when the session reads the record.
    const session = new FixedSession(latin1('a:1:{d:1.5;i:1;}'));
    expect(() => session.get('a')).toThrow('the input breaks the grammar of serialize, which expects an integer or a string key');
  });
});
