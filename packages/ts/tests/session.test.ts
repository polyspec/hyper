// The array session store of Node (HY-104.37): a key that holds no value reads as null. The checks of a stored flash
// and stored kept values are cases of contracts/session.json, which every server runs.
import { describe, expect, it } from 'vitest';
import { ArraySession } from '../src/index.js';

describe('ArraySession', () => {
  it('HY-104.37: returns null for a key that holds no value, also after its removal', () => {
    const store = new ArraySession();
    expect(store.get('missing')).toBeNull();
    store.set('a', 1);
    store.remove('a');
    expect(store.get('a')).toBeNull();
  });
});
