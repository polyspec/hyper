// The read paths of the application of this package (HY-73). The cases of contracts/reads.json are run by case-runner.test.ts.
import { parse } from '@polyspec/template';
import { resolvePath } from '@polyspec/template/render';
import { describe, expect, it } from 'vitest';
import { routeReads } from '../src/index.js';
import { manifest, sources } from './application.js';
import { defined } from './values.js';

describe('read paths (HY-73)', () => {
  it('reads the shared data of every template of a route and the data of each region from its template', () => {
    const parsed = new Map(Object.entries(sources).map(([name, source]) => [name, parse(source, name)]));
    const reads = routeReads(manifest, (name) => defined(parsed.get(name), `the template ${name}`), resolvePath);
    expect(reads.home).toEqual({
      shared: { keys: { title: true, count: true, name: true, shared_only: true } },
      regions: { side: { keys: { count: true } }, content: { keys: { title: true, name: true, shared_only: true } } },
    });
    // The route region keeps a value on the server, so csrf is read whole (HYC-13); its kept paths are read whole.
    expect(defined(reads.list, 'the reads of list').shared).toMatchObject({ keys: { csrf: true } });
    expect(defined(reads.list, 'the reads of list').regions.rows).toEqual({
      keys: {
        items: { each: { keys: { open: true, name: true } }, keys: { 0: { keys: { open: true } }, 1: { keys: { open: true } } } },
        tags: true,
        marks: true,
        flag: true,
        tab: true,
        filter: true,
      },
    });
  });
});
