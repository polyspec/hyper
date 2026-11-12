// The steps of contracts/accept.json (HY-116): the parse of an Accept value and the selection of a media type.
import { Accept } from '../../src/representation/accept.js';
import { InvalidAccept } from '../../src/representation/invalid-accept.js';
import type { CaseReader } from '../case-reader.js';

// The Accept value of a case: a string, or null for a request without Accept.
function acceptOf(reader: CaseReader): string | null {
  const value = reader.input('accept');
  return typeof value === 'string' ? value : null;
}

// Runs a parse or a selection, and compares `invalid` when it refuses the value.
function refused(reader: CaseReader, run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof InvalidAccept)) throw error;
    reader.compare('invalid', true);
  }
}

export const steps = {
  parse(reader: CaseReader): void {
    const value = acceptOf(reader);
    refused(reader, () => {
      const ranges = Accept.parse(value);
      reader.compare(
        'ranges',
        ranges.map((range) => ({ type: range.type, subtype: range.subtype, parameters: range.parameters.map((pair) => [...pair]), weight: range.weight })),
      );
    });
  },
  select(reader: CaseReader): void {
    const value = acceptOf(reader);
    const listed = reader.input('types');
    const types = Array.isArray(listed) ? listed.filter((type): type is string => typeof type === 'string') : [];
    refused(reader, () => {
      reader.compare('selected', Accept.best(Accept.parse(value), types)[0]);
    });
  },
};
