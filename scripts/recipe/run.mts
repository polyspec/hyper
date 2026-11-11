// One run of the recipe check over a tree (HYR-8): the spec is validated, the three readers run, the sources are
// compared with the spec, and the case results are checked (HYR-7).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ValidateFunction } from 'ajv';
import { compare } from './compare.mts';
import { readSources } from './readers.mts';
import { checkResults, type Results } from './results.mts';
import type { Finding, Lang, Sources, Spec } from './types.mts';

export type Validators = { spec: ValidateFunction<Spec>; sources: ValidateFunction<Sources> };

export function runChecks(root: string, v: Validators, results: Results): Finding[] {
  const specDoc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  if (!v.spec(specDoc)) {
    return (v.spec.errors ?? []).map((e) => ({ code: 'SPEC_INVALID', message: `${e.instancePath} ${e.message}` }));
  }
  const spec = specDoc;
  const sources: Record<Lang, Sources> = {
    php: readSources(root, 'php', spec, v.sources),
    node: readSources(root, 'node', spec, v.sources),
    python: readSources(root, 'python', spec, v.sources),
  };
  const protocol = readFileSync(path.join(root, 'docs', 'spec', 'protocol.md'), 'utf8');
  return [...compare(spec, sources, root, protocol), ...checkResults(root, spec, results)];
}
