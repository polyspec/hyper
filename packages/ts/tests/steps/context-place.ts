// The step of the section withContext of contracts/context.json (HY-10, HY-128): the place of the context in the
// shared data. The Node step gives the member of the server, and the browser step that of the browser package.
import type { MapValue, Value } from '@polyspec/template/render';
import type { CaseReader } from '../case-reader.ts';
import { stringsOf } from '../inputs.ts';

// The failure of HY-132 that an error gives: its kind, its status, the category of its class (HY-132.2) and its message.
function raisesOf(error: Error): Record<string, unknown> {
  const { kind, status } = error as Error & { kind?: unknown; status?: unknown };
  const category = error instanceof RangeError ? 'value' : error instanceof TypeError ? 'type' : null;
  return { kind: kind ?? null, status: status ?? null, category, message: error.message };
}

export function placesContext(reader: CaseReader, withContext: (shared: MapValue, context: MapValue) => MapValue): void {
  const shared: MapValue = new Map(stringsOf(reader.input('shared'), 'the case field shared').map((name) => [name, name]));
  let keys: string[] | null = null;
  let context: Value | null = null;
  let raises: Record<string, unknown> | null = null;
  try {
    const placed = withContext(shared, new Map<string, Value>([['name', 'Board']]));
    keys = [...placed.keys()];
    context = placed.get('context') ?? null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    raises = raisesOf(error);
  }
  reader.compare('keys', keys);
  reader.compare('context', context);
  reader.compare('raises', raises);
}
