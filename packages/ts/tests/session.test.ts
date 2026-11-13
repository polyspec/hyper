// The session values of one browser session (HY-24, HY-25, HY-40): a stored value that is not a map of values fails,
// since the session stores only values of the data model.
import { describe, expect, it } from 'vitest';
import { ArraySession } from '../src/index.js';
import { Session } from '../src/session/session.js';

describe('Session', () => {
  it('fails for stored flash values or kept values that are not a map of values', () => {
    const store = new ArraySession();
    const session = new Session(store);
    store.set('_hyper_flash', new Map([['values', new Map([['a', Symbol('a')]])]]));
    expect(() => session.takeFlash()).toThrow('hyper: the session holds flash or kept values that are not a map of values');
    store.set('_hyper_keep', new Map([['rows', new Map([[1, 'title']])]]));
    expect(() => session.kept('rows')).toThrow('hyper: the session holds flash or kept values that are not a map of values');
    expect(() => session.keep('rows', 'sort', 'title')).toThrow('hyper: the session holds flash or kept values that are not a map of values');
    store.set('_hyper_keep', new Map([[1, new Map()]]));
    expect(() => session.keep('rows', 'sort', 'title')).toThrow('hyper: the session holds kept values under a region name that is not a string');
  });
});
