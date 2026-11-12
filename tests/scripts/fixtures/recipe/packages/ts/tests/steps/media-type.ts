import type { CaseReader } from '../case-reader.ts';
import { EssenceReader } from './essence-reader.ts';

export const steps = {
  essence(reader: CaseReader): void {
    const essences = new EssenceReader();
    reader.compare('expected', essences.read('text/plain'));
  },
};
