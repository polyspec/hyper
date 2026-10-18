// Two writes of one session file, one of them interleaved between the write and the rename of the other (HY-104). Two
// server processes write one session file at the same time; the synchronous calls of one process cannot interleave,
// so the test runs the second write from the first rename of the first.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSessions } from '../src/index.js';
import { present } from './support.js';

let interleave: (() => void) | null = null;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      const next = interleave;
      interleave = null;
      next?.();
      return actual.renameSync(from, to);
    },
  };
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-sessions-race-'));
});
afterEach(() => {
  interleave = null;
  rmSync(directory, { recursive: true, force: true });
});

describe('FileSessions with two writers of one session', () => {
  it('does not fail the write of one session when the other write renames its file first (HY-104)', async () => {
    const created = new FileSessions({ directory });
    const first = await created.open(null);
    first.set('a', 1);
    first.close();
    const id = present(first.created);

    const writer = await new FileSessions({ directory }).open(id);
    writer.set('a', 2);
    const other = await new FileSessions({ directory }).open(id);
    other.set('a', 3);
    interleave = () => other.close();

    expect(() => writer.close()).not.toThrow();
    const reopened = await new FileSessions({ directory }).open(id);
    expect(reopened.get('a')).toBe(2);
    reopened.close();
    expect(readdirSync(directory)).toEqual([id]);
  });
});
