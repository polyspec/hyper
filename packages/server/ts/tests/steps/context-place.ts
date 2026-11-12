// The step of the section withContext of contracts/context.json (HY-10, HY-128): the place of the context in the
// shared data. The Node step gives the member of the server, and the browser step that of the browser package.
import type { MapValue, Value } from '@polyspec/template/render';
import type { CaseReader } from '../case-reader.ts';
import { stringsOf } from '../inputs.ts';

export function placesContext(reader: CaseReader, withContext: (shared: MapValue, context: MapValue) => MapValue): void {
  const shared: MapValue = new Map(stringsOf(reader.input('shared'), 'the case field shared').map((name) => [name, name]));
  let keys: string[] | null = null;
  let context: Value | null = null;
  let fails = false;
  try {
    const placed = withContext(shared, new Map<string, Value>([['name', 'Board']]));
    keys = [...placed.keys()];
    context = placed.get('context') ?? null;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already holds the member context')) throw error;
    fails = true;
  }
  reader.compare('keys', keys);
  reader.compare('context', context);
  reader.compare('fails', fails);
}
