// The order of the shared data with a context (HY-10, HY-73). The cases of contracts/context.json are in steps/context.ts.
import { describe, expect, it } from 'vitest';
import { withContext } from '../src/context.js';
import type { Value } from '../src/values.js';

describe('the order of the shared data (HY-10, HY-73)', () => {
  const held = new Map<string, Value>([['name', 'Board']]);
  const keys = (map: Map<string, Value>): string[] => [...map.keys()];

  it('places the context after csrf when the read paths keep csrf', () => {
    const shared = new Map<string, Value>([['title', 'T'], ['csrf', 'c'], ['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['title', 'csrf', 'context', 'site']);
  });

  it('places the context right after title when the read paths removed csrf', () => {
    const shared = new Map<string, Value>([['title', 'T'], ['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['title', 'context', 'site']);
  });

  it('never places the context before title', () => {
    const shared = new Map<string, Value>([['title', 'T']]);
    expect(keys(withContext(shared, held))[0]).toBe('title');
  });

  it('places the context first only when neither title nor csrf is kept', () => {
    const shared = new Map<string, Value>([['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['context', 'site']);
  });
});
