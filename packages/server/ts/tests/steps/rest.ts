// The steps of contracts/rest.json (HY-49): a rest parameter takes the rest of the path.
import type { CaseReader } from '../case-reader.js';
import { refusesPath, routerOf } from './routes.js';

export const steps = {
  cases(reader: CaseReader): void {
    reader.compare('result', routerOf(reader.input('routes')).match(reader.input('path') as string));
  },
  invalidPaths: refusesPath,
};
