// The parse steps of contracts/cookies.json (HY-129): a header is text whose characters U+0000 to U+00FF are its bytes.
import { parse } from '../../src/cookies.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  parse(reader: CaseReader): void {
    const header = reader.input('header') as string | null;
    reader.compare('cookies', Object.fromEntries(parse(header ?? undefined)));
  },
};
