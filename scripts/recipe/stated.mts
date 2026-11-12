// The stated members and the steps of the recipe check (HYR-5, HYR-7): every member that two or more languages have is
// stated directly by a section whose step calls it, or through the calls of the sources from directly stated members,
// and the step of each section sits at its place and in its registry. The check reads a call as a member name with the
// class of its receiver, which it takes only from what the sources write (HYR-5); the readers give the scopes, and this
// module evaluates the classes with the families of `extends` and the `output` of the spec.

import path from 'node:path';
import type { Ctx } from './context.mts';
import { symbolName, words } from './names.mts';
import { LANGS, type ClassRef, type Expr, type Lang, type Member, type Scope, type Sources, type Spec, type Unit } from './types.mts';

/** The three numbers of HYR-5 that a passing run prints. */
export type Counts = { direct: number; internal: number; private: number };

const CONSTRUCTOR: Record<Lang, string> = { php: '__construct', node: 'constructor', python: '__init__' };
const CODEC_UNITS = ['json-codec', 'outside-number'];

type Value = { kind: 'class'; ref: ClassRef } | { kind: 'module'; file: string } | undefined;

const refKey = (ref: ClassRef): string => `${ref.file}::${ref.name}`;
const memberKey = (file: string, cls: string, name: string): string => `${file}::${cls}::${name}`;

/** The key of a scope: its file, its class and its own name. */
function scopeKey(s: Scope): string {
  return s.class === undefined ? memberKey(s.file, '', s.name) : memberKey(s.file, s.class, s.name.slice(s.class.length + 1));
}

/** The key of a member of the spec in a language, from its native symbol. */
function nativeKey(lang: Lang, symbol: string): string {
  const at = symbol.indexOf('::');
  const file = symbol.slice(0, at);
  const rest = symbol.slice(at + 2);
  if (lang === 'php') {
    const [fqcn = '', name = ''] = rest.split('::');
    return memberKey(file, fqcn.slice(fqcn.lastIndexOf('\\') + 1), name);
  }
  const dot = rest.indexOf('.');
  return dot < 0 ? memberKey(file, '', rest) : memberKey(file, rest.slice(0, dot), rest.slice(dot + 1));
}

/** The term of an output without `optional<…>`, and the term inside `list<…>` or `map<…>` of one. */
function plain(term: string): string {
  const m = /^optional<(.*)>$/u.exec(term);
  return m?.[1] ?? term;
}
function element(term: string): string | undefined {
  const m = /^(?:list|map)<(.*)>$/u.exec(plain(term));
  return m?.[1];
}

/** The reading of one language: its classes, its scopes, the spec members by key and the classes that each expression has. */
class Language {
  readonly lang: Lang;
  readonly scopes = new Map<string, Scope>();
  readonly members = new Map<string, Member>();
  readonly keyOf = new Map<string, string>();
  private readonly parents = new Map<string, ClassRef[]>();
  private readonly children = new Map<string, ClassRef[]>();
  private readonly properties = new Map<string, ClassRef>();
  private readonly unitClass = new Map<string, ClassRef>();
  private readonly envs = new Map<string, Map<string, ClassRef>>();

  constructor(lang: Lang, spec: Spec, sources: Sources) {
    this.lang = lang;
    for (const s of sources.scopes) this.scopes.set(scopeKey(s), s);
    for (const c of sources.classes) {
      const key = refKey(c);
      this.parents.set(key, c.extends);
      for (const p of c.extends) this.children.set(refKey(p), [...(this.children.get(refKey(p)) ?? []), { file: c.file, name: c.name }]);
      for (const p of c.properties) if (p.type !== undefined) this.properties.set(`${key}::${p.name}`, p.type);
    }
    const byFile = new Map<string, string[]>();
    for (const c of sources.classes) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c.name]);
    for (const u of spec.concerns.flatMap((c) => c.units)) {
      const native = u.native[lang];
      if (native === undefined) continue;
      for (const m of u.members) {
        const symbol = m.native[lang]?.symbol;
        if (symbol === undefined) continue;
        const key = nativeKey(lang, symbol);
        this.members.set(key, m);
        this.keyOf.set(m.id, key);
        const cls = key.split('::')[1] ?? '';
        if (cls !== '' && !this.unitClass.has(u.id)) this.unitClass.set(u.id, { file: native.file, name: cls });
      }
      const declared = byFile.get(native.file) ?? [];
      const [only] = declared;
      if (!this.unitClass.has(u.id) && declared.length === 1 && only !== undefined) this.unitClass.set(u.id, { file: native.file, name: only });
    }
    // The classes of the variables and of the properties that assignments give; a property that one scope assigns is
    // read by another, so the assignments are read until no class is added.
    for (let pass = 0; pass < 4; pass++) {
      let added = false;
      for (const [key, s] of this.scopes) {
        const env = this.environment(s);
        this.envs.set(key, env);
        for (const a of s.assigns) {
          if (typeof a.target === 'string' || s.class === undefined) continue;
          const property = `${s.file}::${s.class}::${a.target.own}`;
          const value = a.type ?? this.classOf(this.value(a.value, s, env));
          if (value !== undefined && !this.properties.has(property)) {
            this.properties.set(property, value);
            added = true;
          }
        }
      }
      if (!added) break;
    }
  }

  private classOf(v: Value): ClassRef | undefined {
    return v?.kind === 'class' ? v.ref : undefined;
  }

  /** The written classes of the variables of a scope: its parameters, its assignments and its loops, in their order. */
  private environment(s: Scope): Map<string, ClassRef> {
    const env = new Map<string, ClassRef>();
    for (const p of s.parameters) if (p.type !== undefined) env.set(p.name, p.type);
    for (let pass = 0; pass < 2; pass++) {
      for (const a of s.assigns) {
        if (typeof a.target !== 'string') continue;
        const value = a.type ?? this.classOf(this.value(a.value, s, env));
        if (value !== undefined) env.set(a.target, value);
      }
      for (const l of s.loops) {
        const value = this.elementOf(l.over, s, env);
        if (value !== undefined) env.set(l.variable, value);
      }
    }
    return env;
  }

  /** The written or assigned class of the property `name` of a class: of the nearest class of its family upwards that has it. */
  private property(ref: ClassRef, name: string): ClassRef | undefined {
    const seen = new Set<string>();
    const queue = [ref];
    while (queue.length > 0) {
      const c = queue.shift();
      if (c === undefined || seen.has(refKey(c))) continue;
      seen.add(refKey(c));
      const found = this.properties.get(`${refKey(c)}::${name}`);
      if (found !== undefined) return found;
      queue.push(...(this.parents.get(refKey(c)) ?? []));
    }
    return undefined;
  }

  /** The class of a term of the spec: a unit, also inside `optional<…>`. */
  private termClass(term: string): ClassRef | undefined {
    return this.unitClass.get(plain(term));
  }

  /** The keys of the member `name` of a class: the nearest class of its family upwards that has it, and the classes that extend it. */
  lookup(ref: ClassRef, name: string, down = true): string[] {
    const found: string[] = [];
    const seen = new Set<string>();
    const queue = [ref];
    while (queue.length > 0) {
      const c = queue.shift();
      if (c === undefined || seen.has(refKey(c))) continue;
      seen.add(refKey(c));
      const key = memberKey(c.file, c.name, name);
      if (this.members.has(key) || this.scopes.has(key)) {
        found.push(key);
        break;
      }
      queue.push(...(this.parents.get(refKey(c)) ?? []));
    }
    if (!down) return found;
    const below = [...(this.children.get(refKey(ref)) ?? [])];
    const done = new Set<string>();
    while (below.length > 0) {
      const c = below.shift();
      if (c === undefined || done.has(refKey(c))) continue;
      done.add(refKey(c));
      const key = memberKey(c.file, c.name, name);
      if ((this.members.has(key) || this.scopes.has(key)) && !found.includes(key)) found.push(key);
      below.push(...(this.children.get(refKey(c)) ?? []));
    }
    return found;
  }

  /** The value of an expression of a scope (HYR-5): a class, a module, or none. */
  value(e: Expr, s: Scope, env: Map<string, ClassRef>): Value {
    switch (e.kind) {
      case 'own':
        return s.class === undefined ? undefined : { kind: 'class', ref: { file: s.file, name: s.class } };
      case 'parent': {
        const [first] = s.class === undefined ? [] : (this.parents.get(refKey({ file: s.file, name: s.class })) ?? []);
        return first === undefined ? undefined : { kind: 'class', ref: first };
      }
      case 'class':
        return { kind: 'class', ref: { file: e.file, name: e.name } };
      case 'module':
        return { kind: 'module', file: e.file };
      case 'variable': {
        const ref = env.get(e.name);
        return ref === undefined ? undefined : { kind: 'class', ref };
      }
      case 'new':
        return { kind: 'class', ref: e.class };
      case 'member': {
        const of = e.call ? undefined : this.classOf(this.value(e.of, s, env));
        const property = of === undefined ? undefined : this.property(of, e.name);
        if (property !== undefined) return { kind: 'class', ref: property };
        const [key] = this.keys(e, s, env);
        if (key === undefined) return undefined;
        const written = this.properties.get(key);
        if (written !== undefined) return { kind: 'class', ref: written };
        const output = this.members.get(key)?.output;
        const ref = output === undefined ? undefined : this.termClass(output);
        return ref === undefined ? undefined : { kind: 'class', ref };
      }
      case 'either': {
        const found = new Map<string, ClassRef>();
        for (const alternative of e.of) {
          const ref = this.classOf(this.value(alternative, s, env));
          if (ref !== undefined) found.set(refKey(ref), ref);
        }
        const [only] = found.values();
        return found.size === 1 && only !== undefined ? { kind: 'class', ref: only } : undefined;
      }
      case 'other':
        return undefined;
    }
  }

  /** The class of the items of a loop over an expression: the class inside the `list` or `map` of the output of a member. */
  private elementOf(e: Expr, s: Scope, env: Map<string, ClassRef>): ClassRef | undefined {
    if (e.kind !== 'member') return undefined;
    const [key] = this.keys(e, s, env);
    const output = key === undefined ? undefined : this.members.get(key)?.output;
    const inner = output === undefined ? undefined : element(output);
    return inner === undefined ? undefined : this.termClass(inner);
  }

  /** The keys that a use of a scope reaches: the constructor of a construction, or the members of a read or a call. */
  keys(e: Expr, s: Scope, env?: Map<string, ClassRef>): string[] {
    const own = env ?? this.envs.get(scopeKey(s)) ?? new Map<string, ClassRef>();
    if (e.kind === 'new') return this.lookup(e.class, CONSTRUCTOR[this.lang], false);
    if (e.kind !== 'member') return [];
    const of = this.value(e.of, s, own);
    if (of === undefined) return [];
    if (of.kind === 'module') {
      const key = memberKey(of.file, '', e.name);
      return this.members.has(key) || this.scopes.has(key) ? [key] : [];
    }
    return this.lookup(of.ref, e.name);
  }

  /** The keys of the scopes of a class of a file. */
  classScopes(ref: ClassRef): string[] {
    return [...this.scopes.values()].filter((s) => s.file === ref.file && s.class === ref.name).map(scopeKey);
  }
}

/** True when a file lies below one of the directories. */
function below(file: string, dirs: string[]): boolean {
  return dirs.some((d) => file === d || file.startsWith(`${d.replace(/\/$/u, '')}/`));
}

/** The place of the step of a section (HYR-7): its file and its scope key. */
function placeOf(lang: Lang, steps: string, caseFile: string, section: string): { file: string; key: string; shown: string } {
  const w = words(caseFile.replace(/\.json$/u, ''));
  const pascal = w.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (lang === 'php') {
    const file = `${steps}/${pascal}Steps.php`;
    return { file, key: memberKey(file, `${pascal}Steps`, section), shown: `${file}::${pascal}Steps::${section}` };
  }
  if (lang === 'node') {
    const file = `${steps}/${w}.ts`;
    return { file, key: memberKey(file, '', `steps.${section}`), shown: `${file}::steps.${section}` };
  }
  const file = `${steps}/${w.replaceAll('-', '_')}_steps.py`;
  const name = words(section).replaceAll('-', '_');
  return { file, key: memberKey(file, '', name), shown: `${file}::${name}` };
}

/** The scope key that a registry entry names. */
function entryKey(lang: Lang, step: { file: string; name: string }): string {
  if (lang === 'php') {
    const dot = step.name.indexOf('.');
    return memberKey(step.file, step.name.slice(0, dot), step.name.slice(dot + 1));
  }
  return memberKey(step.file, '', step.name);
}

/** The languages that a member has, and the members that two or more languages have. */
const languagesOf = (m: Member): Lang[] => LANGS.filter((l) => m.native[l] !== undefined);

/** The native name of a member in a language, for a message. */
function nativeName(m: Member, lang: Lang): string {
  const symbol = m.native[lang]?.symbol;
  return symbol === undefined ? m.id : symbolName(symbol);
}

/** Checks the steps of every section and the stated members (HYR-5, HYR-7), and returns the three numbers of HYR-5. */
export function checkStated(ctx: Ctx): Counts {
  const { spec, sources, add } = ctx;
  const languages: Record<Lang, Language> = {
    php: new Language('php', spec, sources.php),
    node: new Language('node', spec, sources.node),
    python: new Language('python', spec, sources.python),
  };
  const units = spec.concerns.flatMap((c) => c.units);
  const memberById = new Map<string, Member>();
  const unitOfMember = new Map<string, Unit>();
  for (const u of units) {
    for (const m of u.members) {
      memberById.set(m.id, m);
      unitOfMember.set(m.id, u);
    }
  }

  // HYR-2: an empty list of case files fails as `none` does, for a concern with a unit that two languages have.
  for (const c of spec.concerns) {
    if (Array.isArray(c.cases) && c.cases.length === 0 && c.units.some((u) => Object.keys(u.native).length >= 2)) {
      add('CASES_EMPTY', `concern ${c.id} names no case file`);
    }
  }

  // The members that a section names, for each language whose runner the section names (HYR-7).
  const named = new Map<Lang, Set<string>>(LANGS.map((l) => [l, new Set<string>()]));
  const namedAnywhere = new Set<string>();
  const sections = Object.entries(spec.caseFiles).flatMap(([file, cf]) => Object.entries(cf.sections).map(([name, s]) => ({ file, name, s })));
  for (const { s } of sections) {
    for (const id of s.members ?? []) {
      namedAnywhere.add(id);
      for (const lang of LANGS) if (s.runners.includes(lang) && memberById.get(id)?.native[lang] !== undefined) named.get(lang)?.add(id);
    }
  }

  checkSteps(ctx, languages, sections, memberById, unitOfMember);

  // HYR-5: the directly stated members of each language, a member of that language alone with a section or a native test included.
  const direct = new Map<Lang, Set<string>>();
  for (const lang of LANGS) {
    const set = new Set(named.get(lang));
    for (const u of units) {
      for (const m of u.members) {
        const langs = languagesOf(m);
        if (langs.length === 1 && langs[0] === lang && (namedAnywhere.has(m.id) || (m.tests ?? []).length > 0 || (u.tests ?? []).length > 0)) set.add(m.id);
      }
    }
    direct.set(lang, set);
  }

  // The members that each directly stated member reaches by the calls of the sources, per language.
  const reachers = new Map<Lang, Map<string, Set<string>>>();
  for (const lang of LANGS) {
    const language = languages[lang];
    const byMember = new Map<string, Set<string>>();
    for (const id of direct.get(lang) ?? []) {
      const start = language.keyOf.get(id);
      if (start === undefined) continue;
      for (const key of reach(language, [start], () => true)) {
        const reached = language.members.get(key);
        if (reached === undefined || reached.id === id) continue;
        byMember.set(reached.id, new Set([...(byMember.get(reached.id) ?? []), id]));
      }
    }
    reachers.set(lang, byMember);
  }

  const counts: Counts = { direct: 0, internal: 0, private: 0 };
  for (const m of memberById.values()) {
    const langs = languagesOf(m);
    if (langs.length < 2) continue;
    if (m.visibility === 'public' || (m.visibility === 'internal' && namedAnywhere.has(m.id))) {
      const missing = m.visibility === 'public' ? langs.filter((l) => !(named.get(l)?.has(m.id) ?? false)) : [];
      for (const lang of missing) add('MEMBER_UNSTATED', `public member ${m.id} has ${lang} code and no section with the ${lang} runner names it`);
      if (missing.length === 0) counts.direct += 1;
      continue;
    }
    let stated = true;
    const sets = new Map<Lang, Set<string>>();
    for (const lang of langs) {
      const set = reachers.get(lang)?.get(m.id) ?? new Set<string>();
      sets.set(lang, set);
      if (set.size === 0) {
        add('MEMBER_UNREACHED', `${m.visibility} member ${m.id} is named by no section and reached by no stated member in ${lang}`);
        stated = false;
      }
    }
    for (const a of langs) {
      for (const b of langs) {
        if (a === b) continue;
        const both = (id: string): boolean => {
          const r = memberById.get(id);
          return r !== undefined && r.native[a] !== undefined && r.native[b] !== undefined;
        };
        const only = [...(sets.get(a) ?? [])].filter((id) => both(id) && !(sets.get(b)?.has(id) ?? false)).sort();
        if (only.length > 0 && (sets.get(b)?.size ?? 0) > 0) {
          add('MEMBER_REACH_DIFFERS', `${m.visibility} member ${m.id} is reached from ${only.join(', ')} in ${a} and not in ${b}`);
          stated = false;
        }
      }
    }
    if (stated && m.visibility === 'internal') counts.internal += 1;
    if (stated && m.visibility === 'private') counts.private += 1;
  }
  return counts;
}

/** The keys that the scopes of `start` reach by their uses, through the scopes that `follow` accepts. */
function reach(language: Language, start: string[], follow: (scope: Scope) => boolean, builds?: (ref: ClassRef) => string[]): Set<string> {
  const seen = new Set<string>(start);
  const queue = [...start];
  while (queue.length > 0) {
    const key = queue.shift();
    const scope = key === undefined ? undefined : language.scopes.get(key);
    if (scope === undefined || !follow(scope)) continue;
    for (const use of scope.uses) {
      const next = [...language.keys(use, scope), ...(use.kind === 'new' && builds !== undefined ? builds(use.class) : [])];
      for (const k of next) {
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return seen;
}

/** HYR-7: the step of each section at its place, the registry of each runner, and the members that each step calls. */
function checkSteps(
  ctx: Ctx,
  languages: Record<Lang, Language>,
  sections: { file: string; name: string; s: Spec['caseFiles'][string]['sections'][string] }[],
  memberById: Map<string, Member>,
  unitOfMember: Map<string, Unit>,
): void {
  const { spec, sources, add } = ctx;
  for (const { file, name, s } of sections) {
    const runnerLangs = LANGS.filter((l) => s.runners.includes(l));
    for (const id of s.members ?? []) {
      const m = memberById.get(id);
      if (m !== undefined && !runnerLangs.some((l) => m.native[l] !== undefined)) {
        add('SECTION_MEMBER_RUNNER', `${file} section ${name} names member ${id}, which none of its runner languages has`);
      }
    }
  }
  for (const lang of LANGS) {
    const language = languages[lang];
    const runner = spec.runners[lang];
    const testDirs = spec.languages[lang].tests;
    const sourceDirs = spec.languages[lang].sources;
    const readerFile = spec.caseReaders[lang].split('::')[0] ?? '';
    const left = (f: string): boolean => f === readerFile || (path.dirname(f) === path.dirname(readerFile) && words(path.basename(f).replace(/\..*$/u, '')) === 'case-rules');
    const follow = (scope: Scope): boolean => below(scope.file, testDirs) && !below(scope.file, sourceDirs) && !left(scope.file);
    const builds = (ref: ClassRef): string[] => (below(ref.file, testDirs) && !left(ref.file) ? language.classScopes(ref) : []);
    const given = new Set<string>();
    const entries = sources[lang].registry;
    for (const { file, name, s } of sections) {
      if (!s.runners.includes(lang)) continue;
      given.add(`${file} ${name}`);
      const place = placeOf(lang, runner.steps, file, name);
      const entry = entries.find((e) => e.file === file && e.section === name);
      if (!language.scopes.has(place.key)) {
        add('STEP_MISSING', `${lang} has no step ${place.shown} for ${file} section ${name}`);
      }
      if (entry === undefined) {
        add('STEP_REGISTRY', `${lang} registry ${runner.registry} maps ${file} section ${name} to nothing, the place is ${place.shown}`);
      } else if (entryKey(lang, entry.step) !== place.key) {
        add('STEP_REGISTRY', `${lang} registry ${runner.registry} maps ${file} section ${name} to ${entry.step.file}::${entry.step.name}, the place is ${place.shown}`);
      }
      if (!language.scopes.has(place.key)) continue;
      const reached = reach(language, [place.key], follow, builds);
      const namedIds = new Set(s.members ?? []);
      for (const id of namedIds) {
        const m = memberById.get(id);
        const key = language.keyOf.get(id);
        if (m === undefined || key === undefined) continue;
        if (!reached.has(key)) add('STEP_MEMBER_UNCALLED', `${lang} step ${place.shown} of ${file} section ${name} does not call ${id} (${nativeName(m, lang)})`);
      }
      for (const key of reached) {
        const m = language.members.get(key);
        const unit = m === undefined ? undefined : unitOfMember.get(m.id);
        if (m !== undefined && unit !== undefined && CODEC_UNITS.includes(unit.id) && !namedIds.has(m.id)) {
          add('STEP_CODEC', `${lang} step ${place.shown} of ${file} section ${name} calls ${m.id}, which the section does not name`);
        }
      }
    }
    for (const e of entries) {
      if (!given.has(`${e.file} ${e.section}`)) {
        add('STEP_REGISTRY', `${lang} registry ${runner.registry} maps ${e.file} section ${e.section} to ${e.step.file}::${e.step.name}, which caseFiles does not give to ${lang}`);
      }
    }
  }
}
