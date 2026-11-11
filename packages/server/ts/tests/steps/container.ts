// The steps of contracts/container.json (HY-105): the services that the handlers receive.
import { Container } from '../../src/container.js';
import type { CaseReader } from '../case-reader.js';

interface Bound { clock: object; mailer: object }

function names(reader: CaseReader, field: string): (keyof Bound)[] {
  const value = reader.input(field);
  return (Array.isArray(value) ? value : []).map((name) => (name === 'clock' ? 'clock' : 'mailer'));
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
