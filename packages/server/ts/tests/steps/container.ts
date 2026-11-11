// The steps of contracts/container.json (HY-105): the services that the handlers receive.
import { Container } from '../../src/container.js';
import type { CaseReader } from '../case-reader.js';

interface Bound { clock: object; mailer: object }

// Returns the service names of a field, and fails for a value that is not a list of the names of the cases.
function names(reader: CaseReader, field: string): (keyof Bound)[] {
  const value: unknown = reader.input(field);
  if (!Array.isArray(value)) throw new Error(`the case field ${field} is not a list`);
  return value.map((name: unknown): keyof Bound => {
    if (name !== 'clock' && name !== 'mailer') throw new Error(`the case field ${field} names the unknown service ${String(name)}`);
    return name;
  });
}

export const steps = {
  services(reader: CaseReader): void {
    const container = new Container<Bound>();
    let created = 0;
    for (const name of names(reader, 'bound')) {
      container.bind(name, () => {
        created += 1;
        return {};
      });
    }
    let failed = false;
    try {
      for (const name of names(reader, 'uses')) container.get(name);
    } catch {
      failed = true;
    }
    reader.compare('created', created);
    reader.compare('failed', failed);
  },
};
