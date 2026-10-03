// The cases of conformance/reads.json (HY-73): the browser package computes the read paths of every case, keeps the
// expected data, and the kept data renders the same bytes as the data. PHP and Node keep the data in ReadsTest and
// reads.test.ts.
import { parse, parseJson, type Template } from '@polyspec/template';
import { MapLoader, resolvePath } from '@polyspec/template/render';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEngine, keepRead, routeReads, type ReadNode } from '../src/index.js';
import { manifest, sources } from './application.js';

interface Case {
  label: string;
  templates: Record<string, string>;
  template: string;
  data: unknown;
  reads: ReadNode;
  kept: unknown;
}

const fixture = JSON.parse(readFileSync(new URL('../../../conformance/reads.json', import.meta.url), 'utf8')) as { cases: Case[] };

// The time limit of the read paths of one case. The analysis runs in its own process, because an analysis that does
// not finish blocks the process that runs it, so a time limit inside the test process cannot stop it.
const READS_LIMIT_MS = 10_000;

function readsWithin(item: Case): ReadNode {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./reads-process.ts', import.meta.url)), JSON.stringify(item)], {
    encoding: 'utf8',
    timeout: READS_LIMIT_MS,
  });
  if (child.error !== undefined) throw new Error(`the read paths of "${item.label}" did not finish within ${READS_LIMIT_MS} ms: ${child.error.message}`);
  if (child.status !== 0) throw new Error(`the read paths of "${item.label}" failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as ReadNode;
}

describe('read paths (HY-73)', () => {
  for (const item of fixture.cases) {
    it(item.label, () => {
      const parsed = new Map(Object.entries(item.templates).map(([name, source]) => [name, parse(source, name)]));
      expect(readsWithin(item)).toEqual(item.reads);

      const data = parseJson(JSON.stringify(item.data));
      const kept = keepRead(data, item.reads);
      expect(kept).toEqual(parseJson(JSON.stringify(item.kept)));

      const loader = new MapLoader();
      for (const [name, template] of parsed) loader.set(name, template);
      const engine = createEngine(loader);
      expect(engine.render(item.template, kept)).toBe(engine.render(item.template, data));
    });
  }

  it('reads the shared data of every template of a route and the data of each region from its template', () => {
    const parsed = new Map(Object.entries(sources).map(([name, source]) => [name, parse(source, name)]));
    const reads = routeReads(manifest, (name) => parsed.get(name)!, resolvePath);
    expect(reads.home).toEqual({
      shared: { keys: { title: true, count: true, name: true, shared_only: true } },
      regions: { side: { keys: { count: true } }, content: { keys: { title: true, name: true, shared_only: true } } },
    });
    // The route region keeps a value on the server, so csrf is read whole (HY-39); its kept paths are read whole.
    expect(reads.list!.shared).toMatchObject({ keys: { csrf: true } });
    expect(reads.list!.regions.rows).toEqual({
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
