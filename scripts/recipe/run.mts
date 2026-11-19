// One run of the recipe check over a tree (HYR-8): the spec is validated, the three readers run, the sources are
// compared with the spec, and the case results are checked (HYR-7).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ValidateFunction } from 'ajv';
import { compare } from './compare.mts';
import { readSources, readTree } from './readers.mts';
import { checkResults, type Results } from './results.mts';
import { readProtocol } from './protocol.mts';
import { withLegacy } from './legacy.mts';
import type { Counts } from './stated.mts';
import { LANGS, type ExtensionNative, type FileNative, type Finding, type Lang, type Member, type Sources, type Spec, type SpecDocument } from './types.mts';
import { isReexport, reexportFindings } from './reexport.mts';

export type Validators = { spec: ValidateFunction<SpecDocument>; sources: ValidateFunction<Sources> };

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

/**
 * The spec without its extension entries (HYR-5): an extension unit names a class of the hyper extension and no file,
 * so no reader reads it and the checks of the sources see it without native entries; make recipe-files checks it. A
 * reexport member (HYR-5) leaves `members` for `passed`, which only keeps its source member from being an added one.
 * The languages of the extension entries stay in `extensions`, because they are native code for `only` (HYR-6).
 */
export function withoutExtensions(doc: SpecDocument): Spec {
  return {
    ...doc,
    concerns: doc.concerns.map((c) => ({
      ...c,
      units: c.units.map((u) => {
        // HYR-5 Reexports: a member that passes a call to a library member is not compared, reached or counted.
        const members = u.members.filter((m): m is Member => !isReexport(m));
        const passed = u.members.filter(isReexport).map((m) => m.id);
        const extensions = LANGS.filter((lang) => { const n = u.native[lang]; return n !== undefined && 'extension' in n; });
        return { ...u, members, ...(passed.length > 0 ? { passed } : {}), ...(extensions.length > 0 ? { extensions } : {}), native: fileEntries(u.native) };
      }),
    })),
  };
}

function fileEntries(native: Partial<Record<Lang, FileNative | ExtensionNative>>): Partial<Record<Lang, FileNative>> {
  const kept: Partial<Record<Lang, FileNative>> = {};
  for (const lang of LANGS) {
    const n = native[lang];
    if (n !== undefined && 'file' in n) kept[lang] = n;
  }
  return kept;
}

/**
 * Runs the checks of a tree; `counts`, when given, receives the three numbers of HYR-5. `cargo` is the cargo command of
 * the Makefile, which finds the interface.json of a library that a reexport names (HYR-5).
 */
export function runChecks(root: string, v: Validators, results: Results, phpAutoload: string, counts?: Counts, cargo: string[] = []): Finding[] {
  const specDoc: unknown = withLegacy(root, JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8')));
  if (!v.spec(specDoc)) {
    return (v.spec.errors ?? []).map((e) => ({ code: 'SPEC_INVALID', message: `${e.instancePath} ${e.message}` }));
  }
  const reexports = reexportFindings(root, specDoc, cargo);
  const spec = withoutExtensions(specDoc);
  const sources = readAllSources(root, spec, v, phpAutoload);
  const readDir = (lang: Lang, dir: string): Sources => readTree(root, lang, [dir], [], v.sources, extraOf(lang, phpAutoload));
  const protocol = readProtocol(readFileSync(path.join(root, 'contracts', 'protocol.json'), 'utf8'));
  return [...reexports, ...compare(spec, sources, root, protocol, readDir, counts), ...checkResults(root, spec, results)];
}
