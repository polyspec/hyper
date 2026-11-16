// The session values of one browser session (HY-24, HY-25, HY-40): rules.flash_of and rules.kept_of of the core check a
// stored flash and stored kept values, and one of another form fails with the kind invalid_session_record (HY-104.23).
import { describe, expect, it } from 'vitest';
import { ArraySession } from '../src/index.js';
import { Session } from '../src/session/session.js';

function kindOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? Reflect.get(error, 'kind') : error;
  }
  return null;
}

describe('Session', () => {
  it('fails with invalid_session_record for a stored flash or stored kept values of another form', () => {
    const store = new ArraySession();
    const session = new Session(store);
    store.set('_hyper_flash', new Map([['values', 1]]));
    expect(kindOf(() => session.takeFlash())).toBe('invalid_session_record');
    store.set('_hyper_keep', new Map([['rows', 1]]));
    expect(kindOf(() => session.kept('rows'))).toBe('invalid_session_record');
    expect(kindOf(() => session.keep('rows', 'sort', 'title'))).toBe('invalid_session_record');
    store.set('_hyper_keep', new Map([['other', 1]]));
    expect(kindOf(() => session.keep('rows', 'sort', 'title'))).toBe('invalid_session_record');
  });
});
