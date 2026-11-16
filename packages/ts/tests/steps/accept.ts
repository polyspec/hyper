// The steps of contracts/accept.json (HY-116): the parse of an Accept value and the selection of a media type.
import { Accept } from '../../src/representation/accept.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';

// The Accept value of a case: a string, or null for a request without Accept.
function acceptOf(reader: CaseReader): string | null {
  const value = reader.input('accept');
  return typeof value === 'string' ? value : null;
}

export const steps = {
  parse(reader: CaseReader): void {
    const value = acceptOf(reader);
    const outcome = failureOf(() =>
      Accept.parse(value).map((range) => ({ type: range.type, subtype: range.subtype, parameters: range.parameters.map((pair) => [...pair]), weight: range.weight })),
    );
    reader.compare('ranges', outcome.result);
    reader.compare('raises', outcome.raises);
  },
  select(reader: CaseReader): void {
    const value = acceptOf(reader);
    const listed = reader.input('types');
    const types = Array.isArray(listed) ? listed.filter((type): type is string => typeof type === 'string') : [];
    const outcome = failureOf(() => Accept.best(Accept.parse(value), types)[0]);
    reader.compare('selected', outcome.result);
    reader.compare('raises', outcome.raises);
  },
};
