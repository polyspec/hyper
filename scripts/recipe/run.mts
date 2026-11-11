// One run of the recipe check over a tree (HYR-8): the spec is validated, the three readers run, the sources are
// compared with the spec, and the case results are checked (HYR-7).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ValidateFunction } from 'ajv';
import { compare } from './compare.mts';
import { readSources, readTree } from './readers.mts';
import { checkResults, type Results } from './results.mts';
import { readProtocol } from './protocol.mts';
import type { Finding, Lang, Sources, Spec } from './types.mts';

export type Validators = { spec: ValidateFunction<Spec>; sources: ValidateFunction<Sources> };

/** The reader options of a language: the PHP reader loads its classes with the autoloader. */
function extraOf(lang: Lang, phpAutoload: string): string[] {
  return lang === 'php' ? ['--autoload', phpAutoload] : [];
}

/** The sources of the three languages, each read by its reader; the PHP reader loads its classes with `phpAutoload`. */
export function readAllSources(root: string, spec: Spec, v: Validators, phpAutoload: string): Record<Lang, Sources> {
  return {
    php: readSources(root, 'php', spec, v.sources, extraOf('php', phpAutoload)),
    node: readSources(root, 'node', spec, v.sources),
    python: readSources(root, 'python', spec, v.sources),
  };
}

export function runChecks(root: string, v: Validators, results: Results, phpAutoload: string): Finding[] {
  const specDoc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  if (!v.spec(specDoc)) {
    return (v.spec.errors ?? []).map((e) => ({ code: 'SPEC_INVALID', message: `${e.instancePath} ${e.message}` }));
  }
  const spec = specDoc;
  const sources = readAllSources(root, spec, v, phpAutoload);
  const readDir = (lang: Lang, dir: string): Sources => readTree(root, lang, [dir], [], v.sources, extraOf(lang, phpAutoload));
  const protocol = readProtocol(readFileSync(path.join(root, 'contracts', 'protocol.json'), 'utf8'));
  return [...compare(spec, sources, root, protocol, readDir), ...checkResults(root, spec, results)];
}
