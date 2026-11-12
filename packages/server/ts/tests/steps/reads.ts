// The cases step of contracts/reads.json (HY-73): the Node server computes the read paths with the browser package
// (templateReads and keepRead of @polyspec/hyper-client), and the kept data renders as the full data does, and the
// template renders alone with its data (HY-13.1).
import { createEngine, keepRead, templateReads } from '@polyspec/hyper-client';
import type { CaseReader } from '../case-reader.js';
import { readsCases } from './reads-cases.js';

export const steps = {
  cases: (reader: CaseReader): void => {
    readsCases(reader, { templateReads, keepRead, createEngine });
  },
};
