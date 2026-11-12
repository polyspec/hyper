// The parts of a head application: they start in order, load together and are removed together (HYC-15, HYC-25).
import { describe, expect, it } from 'vitest';
import { applyHead, HeadError, type HeadPart } from '../src/head.js';

describe('applyHead (HYC-15, HYC-25)', () => {
  // A part that records its removal and its settling under a name.
  const part = (events: string[], name: string, wait: () => Promise<void>): HeadPart => ({
    wait,
    remove: () => events.push(`remove ${name}`),
    settle: () => events.push(`settle ${name}`),
  });
  const loads = async (): Promise<void> => undefined;

  it('settles every part only when the returned function runs', async () => {
    const events: string[] = [];
    const settle = await applyHead([() => part(events, 'links', loads), () => part(events, 'scripts', loads)]);
    expect(events).toEqual([]);
    settle();
    expect(events).toEqual(['settle links', 'settle scripts']);
  });

  it('removes what every part put into the page when one part fails to load', async () => {
    const events: string[] = [];
    const failure = new HeadError('hyper: module script http://site.test/a.js failed to load');
    const fails = async (): Promise<void> => {
      throw failure;
    };
    await expect(applyHead([() => part(events, 'links', loads), () => part(events, 'scripts', fails)])).rejects.toBe(failure);
    expect(events).toEqual(['remove links', 'remove scripts']);
  });

  it('removes the started parts when a later part fails to start', async () => {
    const events: string[] = [];
    const failure = new TypeError('Invalid URL');
    const start = (): HeadPart => {
      throw failure;
    };
    await expect(applyHead([() => part(events, 'links', loads), start])).rejects.toBe(failure);
    expect(events).toEqual(['remove links']);
  });
});
