// The cases of contracts/reads.json (HY-73). The Node server computes the read paths with the browser package
// (routeReads and keepRead of @polyspec/hyper-client), and PHP and Python pass the same cases in ReadsTest and
// test_reads.py. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { parse, parseJson } from '@polyspec/template';
import { MapLoader, resolvePath } from '@polyspec/template/render';
import { createEngine, keepRead, templateReads, type ReadNode } from '@polyspec/hyper-client';
import { expect, it } from 'vitest';
import { list, parsed, record, text } from './support.js';

const fixture = record(parsed(readFileSync(new URL('../../../../contracts/reads.json', import.meta.url), 'utf8')));

it.each(list(fixture.cases).map(record).map((item) => [text(item.id), item] as const))('%s', (_id, item) => {
  const sources = new Map(Object.entries(record(item.templates)).map(([name, source]) => [name, text(source)] as const));
  const templates = new Map([...sources].map(([name, source]) => [name, parse(source, name)] as const));
  const template = text(item.template);
  const reads = templateReads((name) => {
    const found = templates.get(name);
    if (found === undefined) throw new Error(`the template ${name} is missing`);
    return found;
  }, resolvePath, template);
  expect(reads).toEqual(item.reads);

  const data = parseJson(JSON.stringify(item.data));
  const kept = keepRead(data, item.reads as ReadNode);
  expect(kept).toEqual(parseJson(JSON.stringify(item.kept)));

  const loader = new MapLoader();
  for (const [name, source] of templates) loader.set(name, source);
  const engine = createEngine(loader);
  expect(engine.render(template, kept)).toBe(engine.render(template, data));
});
