// The cases step of contracts/reads.json (HY-73): the Node server computes the read paths with the browser package
// (templateReads and keepRead of @polyspec/hyper-client), and the kept data renders as the full data does, and the
// template renders alone with its data (HY-13.1).
import { parse } from '@polyspec/template';
import { MapLoader, resolvePath, type Value } from '@polyspec/template/render';
import { createEngine, keepRead, templateReads } from '@polyspec/hyper-client';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  cases(reader: CaseReader): void {
    const sources = reader.input('templates') as Map<string, string>;
    const templates = new Map([...sources].map(([name, source]) => [name, parse(source, name)] as const));
    const template = reader.input('template') as string;
    const reads = templateReads((name) => {
      const found = templates.get(name);
      if (found === undefined) throw new Error(`the template ${name} is missing`);
      return found;
    }, resolvePath, template);
    reader.compare('reads', reads);

    const data = reader.input('data') as Value;
    const kept = keepRead(data, reads);
    reader.compare('kept', kept);

    const loader = new MapLoader();
    for (const [name, source] of templates) loader.set(name, source);
    const engine = createEngine(loader);
    const text = engine.render(template, data);
    reader.compare('text', text);
    reader.outcome('render', [engine.render(template, kept), text]);
  },
};
