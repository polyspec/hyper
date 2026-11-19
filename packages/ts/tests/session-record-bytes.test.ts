// The session record in the form php_serialize of PHP (HY-104.13, HY-104.14): the record codec is
// @polyspec/php-serialization, so a record with a key of bytes that are not UTF-8, a float and a nested stdClass reads
// to the values of the data model and writes back the same bytes, and a float or a stdClass that the application makes
// with that package is stored as it is (H35.77).
import { PhpFloat, StdClass, unserialize } from '@polyspec/php-serialization';
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

// The bytes of PHP serialize(["\xff\xfe" => 1, "a" => 1.5, "b" => 1.0, "o" => (object) ["x" => 1]]). A float with an
// integral value is a PhpFloat, so that it stays a float when it is written again.
const RECORD = latin1('a:4:{s:2:"\xff\xfe";i:1;s:1:"a";d:1.5;s:1:"b";d:1;s:1:"o";O:8:"stdClass":1:{s:1:"x";i:1;}}');

describe('the session record of php-serialization', () => {
  it('reads a key of bytes that are not UTF-8, a float and a stdClass, and writes the same bytes back', () => {
    const session = new FixedSession(RECORD);
    expect(session.get('a')).toBe(1.5);
    expect(session.get('o')).toEqual(new Map([['x', 1]]));
    expect(session.serialized()).toEqual(RECORD);
    const stored = unserialize(session.serialized() ?? new Uint8Array());
    if (!(stored instanceof Map)) throw new Error('the record is no map');
    const keys = [...stored.keys()];
    expect(keys[0]).toEqual(Uint8Array.of(0xff, 0xfe));
    expect(stored.get('a')).toBe(1.5);
    expect(stored.get('b')).toBeInstanceOf(PhpFloat);
  });

  it('stores a PhpFloat and a StdClass of php-serialization as PHP writes them', () => {
    const session = new FixedSession(new Uint8Array());
    session.set('f', new PhpFloat(1.5));
    session.set('o', new StdClass(new Map([['x', 1]])));
    expect(session.serialized()).toEqual(latin1('a:2:{s:1:"f";d:1.5;s:1:"o";O:8:"stdClass":1:{s:1:"x";i:1;}}'));
  });
});
