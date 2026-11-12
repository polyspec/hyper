// The cases step of contracts/reads.json (HY-73): the read paths of the templates, the kept data, which renders as the
// full data does, and the template rendered alone with its data (HY-13.1). The Node step gives the functions of the
// built browser package, and the browser step those of its source.
import { parse } from '@polyspec/template';
import { MapLoader, NativeObject, resolvePath, SafeString, type Value } from '@polyspec/template/render';
import type { CaseReader } from '../case-reader.ts';
import { textMapOf, textOf } from '../inputs.ts';

// Returns true for a value of the template data model.
function isValue(value: unknown): value is Value {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return true;
  if (value instanceof SafeString || value instanceof NativeObject) return true;
  if (Array.isArray(value)) return value.every(isValue);
  return value instanceof Map && [...value].every(([key, item]) => typeof key === 'string' && isValue(item));
}

export function readsCases<Reads>(
  reader: CaseReader,
  api: {
    templateReads: (load: (name: string) => ReturnType<typeof parse>, resolve: typeof resolvePath, template: string) => Reads;
    keepRead: (data: Value, reads: Reads) => Value;
    createEngine: (loader: MapLoader) => { render(template: string, data: Value): string };
  },
): void {
  const sources = textMapOf(reader.input('templates'), 'templates');
  const templates = new Map([...sources].map(([name, source]) => [name, parse(source, name)] as const));
  const template = textOf(reader.input('template'), 'template');
  const reads = api.templateReads(
    (name) => {
      const found = templates.get(name);
      if (found === undefined) throw new Error(`the template ${name} is missing`);
      return found;
    },
    resolvePath,
    template,
  );
  reader.compare('reads', reads);

  const data = reader.input('data');
  if (!isValue(data)) throw new Error('data is not a value of the data model');
  const kept = api.keepRead(data, reads);
  reader.compare('kept', kept);

  const loader = new MapLoader();
  for (const [name, source] of templates) loader.set(name, source);
  const engine = api.createEngine(loader);
  const whole = engine.render(template, data);
  // HY-13.1: the template rendered alone with its data.
  if (reader.has('text')) reader.compare('text', whole);
  reader.outcome('render', [engine.render(template, kept), whole]);
}
