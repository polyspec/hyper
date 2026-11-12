// Names of the recipe check (HYR-4, HYR-5): the words of a name, the file and member names each language takes, and
// the vocabulary terms. Pure functions; the checks that use them live in the modules next to this one.

import path from 'node:path';
import { type Lang, type Member, type Visibility } from './types.mts';

const CTOR_NAMES = ['__construct', '__init__', 'constructor'];

/** Words of a name, lowercased and joined by `-`: `MediaType`, `media-type` and `media_type` all give `media-type`. */
export function words(name: string): string {
  return name
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase())
    .join('-');
}

/** HYR-4: no name holds two uppercase letters in a row. */
export function hasAcronym(name: string): boolean {
  return /[A-Z]{2}/u.test(name);
}

/** The file name HYR-4 gives a unit: PascalCase for PHP, kebab for Node, snake for Python with `_` when internal. */
export function expectedFile(lang: Lang, id: string, internal: boolean): string {
  const parts = id.split('-');
  if (lang === 'php') return `${parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}.php`;
  if (lang === 'node') return `${id}.ts`;
  return `${internal ? '_' : ''}${parts.join('_')}.py`;
}

/** Member key of the spec and of a reader member: constructors share one key whatever the language calls them. */
export function specKey(m: Pick<Member, 'id' | 'kind'>): string {
  return m.kind === 'constructor' ? 'constructor' : words(m.id.slice(m.id.indexOf('.') + 1));
}

export function readerKey(name: string, kind: string): string {
  return kind === 'constructor' || CTOR_NAMES.includes(name) ? 'constructor' : words(name);
}

/** HYR-5 "Names": PHP and Node keep the camelCase name; Python writes it in snake_case, and a private one with a leading `_`. */
export function expectedNative(lang: Lang, member: Pick<Member, 'id' | 'kind' | 'visibility'>, file = ''): string | undefined {
  if (member.kind === 'constructor') return undefined;
  const camel = member.id.slice(member.id.indexOf('.') + 1);
  // HYR-5 "Symbol": the method that makes a PHP object callable is `__invoke`.
  if (lang === 'php' && camel === 'invoke') return '__invoke';
  if (lang !== 'python') return camel;
  const snake = camel.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  // HYR-5: a private member has a leading `_`, and so has an internal member of a public module; in a `_` module the
  // module makes it internal.
  const publicModule = !path.basename(file).startsWith('_');
  return member.visibility === 'private' || (member.visibility === 'internal' && publicModule) ? `_${snake}` : snake;
}

/** The last name of a native symbol: `Csrf.raw`, `Polyspec\Hyper\Csrf::raw` and `_csrf.py::Csrf.__init__` all give the member. */
export function symbolName(symbol: string): string {
  return symbol.split('::').pop()?.split('.').pop() ?? symbol;
}

/** Python has no `private`: a private member is `_`-prefixed and reads as internal. */
export function expectedVisibility(lang: Lang, v: Visibility): Visibility {
  return lang === 'python' && v === 'private' ? 'internal' : v;
}

/** The test key of a native test reference `<file>::<name>: <reason>`. */
export function testKey(ref: string): string {
  const at = ref.indexOf(': ', ref.indexOf('::') + 2);
  return at < 0 ? ref : ref.slice(0, at);
}

/** Splits a list at its top-level commas; `->` is not a closing bracket. */
export function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '<') depth++;
    if ((ch === ')' || ch === '>') && list[i - 1] !== '-') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** HYR-5: a term is a term of the vocabulary (the spec's units and types, protocol.json's terms), or list, map, optional or function of terms. */
export function termKnown(term: string, ids: Set<string>): boolean {
  if (ids.has(term)) return true;
  const generic = /^(?:list|map|optional)<(.*)>$/u.exec(term);
  if (generic) return termKnown(generic[1] ?? '', ids);
  const fn = /^function\((.*)\) -> (.+)$/u.exec(term);
  if (fn) return [...splitTop(fn[1] ?? ''), fn[2] ?? ''].every((t) => termKnown(t, ids));
  return false;
}

/** HYR-5: an error is a status of protocol.json (the status is named as a whole word in it) or an error unit of the spec. */
export function errorKnown(term: string, ids: Set<string>, flat: string): boolean {
  return ids.has(term) || new RegExp(`\\b${term}\\b`, 'u').test(flat);
}
