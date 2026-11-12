// The candidate of the development spec (HYR-10): the spec with its native fields refreshed from the readers. The
// hand-written fields (neutral fields, concern fields, unit grouping, `only`, type shape) keep their values; their JSON
// pointers go to a sidecar file, so that the reviewed change of the spec can tell them apart from the native fields.
// Usage: node scripts/recipe/candidate.mts [--root <dir>] --php-autoload <autoload.php> [--output <file>]
// Prints `CANDIDATE_STALE <pointer>` for each native item that the readers no longer find.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readAllSources, type Validators } from './run.mts';
import { readerKey, words } from './names.mts';
import { LANGS, type Concern, type Lang, type Member, type Sources, type Spec, type SpecType, type Unit, type Visibility } from './types.mts';
import { validators } from './validators.mts';

export type Candidate = { spec: Spec; handWritten: string[]; stale: string[] };

type ReaderMember = Sources['members'][number];
type ReaderType = Sources['types'][number];

/** The placeholder of a hand-written term: a term of the closed vocabulary (HYR-5), listed in the sidecar. */
const PLACEHOLDER_TERM = 'string';
/** The placeholder of a hand-written state, listed in the sidecar. */
const PLACEHOLDER_STATE = 'to be written';

/** The join key of a source file: the words of its file name (HYR-4). */
function keyOf(file: string): string {
  return words(path.basename(file, path.extname(file)));
}

/** The member part of a kebab word group: `raw-token` is `rawToken` (HYR-5). */
function camel(kebab: string): string {
  return kebab.split('-').map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
}

/** What the readers of the languages read of one member or type, in the order of the languages. */
function readOf<T>(entry: Partial<Record<Lang, T>>): T[] {
  return LANGS.flatMap((lang) => {
    const read = entry[lang];
    return read === undefined ? [] : [read];
  });
}

/**
 * The visibility of a member or a type of the spec, which has no `protected`: the readers record a protected method,
 * and a candidate cannot state one, so it stops with the name of what it read.
 */
function specVisibility(visibility: Visibility, what: string): Member['visibility'] {
  if (visibility === 'protected') throw new Error(`${what} is protected, which the spec has no visibility for`);
  return visibility;
}

/**
 * Derives the members of a unit from the sources of its files (HYR-5): the members of each file joined across languages
 * by their reader key. The neutral fields take placeholders; a kind, a visibility or an `only` that the languages do
 * not agree on is flagged.
 */
function deriveMembers(unit: Unit, sources: Record<Lang, Sources>, flag: (item: Member, what: string) => void): void {
  const byKey = new Map<string, Partial<Record<Lang, ReaderMember>>>();
  for (const lang of LANGS) {
    const file = unit.native[lang]?.file;
    if (file === undefined) continue;
    for (const m of sources[lang].members.filter((r) => r.file === file)) {
      const key = readerKey(m.name, m.kind);
      const entry = byKey.get(key) ?? {};
      entry[lang] = m;
      byKey.set(key, entry);
    }
  }
  for (const [key, entry] of byKey) {
    const list = readOf(entry);
    const first = list[0];
    if (first === undefined) continue;
    const member: Member = {
      id: `${unit.id}.${camel(key)}`,
      kind: first.kind,
      visibility: specVisibility(first.visibility, `the member ${first.symbol}`),
      inputs: first.parameters.map(() => PLACEHOLDER_TERM),
      output: PLACEHOLDER_TERM,
      errors: [],
      state: PLACEHOLDER_STATE,
      native: {},
    };
    for (const lang of LANGS) {
      const r = entry[lang];
      if (r !== undefined) member.native[lang] = { symbol: r.symbol, signature: r.signature };
    }
    if (!list.every((r) => r.kind === first.kind)) flag(member, 'kind');
    if (!list.every((r) => r.visibility === first.visibility)) flag(member, 'visibility');
    if (list.length < Object.keys(unit.native).length) flag(member, 'only');
    unit.members.push(member);
  }
}

/**
 * Derives the concerns and types of a skeleton spec from the sources (HYR-2, HYR-3, HYR-4): each source file that holds
 * a unit is a unit, joined across languages by its words, and each unit is its own concern. The facts the readers cannot
 * state (rules, cases, inputs, output, state, shapes) take placeholders. Their pointers, and the pointers of the kind,
 * visibility and `only` that the languages do not agree on, go to `handWritten`.
 */
function deriveSpec(spec: Spec, sources: Record<Lang, Sources>, handWritten: string[]): void {
  const flagged = new Map<object, string[]>();
  const flag = (item: object, what: string): void => {
    flagged.set(item, [...(flagged.get(item) ?? []), what]);
  };

  const units = new Map<string, Unit>();
  for (const lang of LANGS) {
    for (const file of sources[lang].files) {
      if (spec.languages[lang].barrel.includes(file)) continue;
      const found = sources[lang].units.find((u) => u.file === file);
      if (found === undefined) continue;
      const key = keyOf(file);
      const unit = units.get(key) ?? { id: key, native: {}, members: [] };
      unit.native[lang] = { file, kind: found.kind, internal: found.internal };
      units.set(key, unit);
    }
  }

  for (const unit of units.values()) {
    if (Object.keys(unit.native).length < LANGS.length) flag(unit, 'only');
    deriveMembers(unit, sources, flag);
  }

  const typeEntries = new Map<string, Partial<Record<Lang, ReaderType>>>();
  for (const lang of LANGS) {
    for (const t of sources[lang].types) {
      const key = words(t.name);
      if (units.has(key)) continue;
      const entry = typeEntries.get(key) ?? {};
      entry[lang] = t;
      typeEntries.set(key, entry);
    }
  }
  const types: SpecType[] = [];
  for (const [key, entry] of typeEntries) {
    const list = readOf(entry);
    const first = list[0];
    // An entry holds the type of at least one language; without one there is nothing to derive.
    if (first === undefined) continue;
    const fields = first.fields ?? [];
    const type: SpecType = {
      id: camel(key),
      visibility: specVisibility(first.visibility, `the type ${first.file}::${first.name}`),
      unit: keyOf(first.file),
      shape: fields.length > 0 ? { fields: Object.fromEntries(fields.map((f) => [f, PLACEHOLDER_TERM])), optional: [] } : { term: PLACEHOLDER_TERM },
      native: {},
    };
    for (const lang of LANGS) {
      const r = entry[lang];
      if (r !== undefined) type.native[lang] = { symbol: `${r.file}::${r.name}`, declaration: r.declaration };
    }
    if (!list.every((r) => r.visibility === first.visibility)) flag(type, 'visibility');
    if (list.length < LANGS.length) flag(type, 'only');
    types.push(type);
  }

  const concerns: Concern[] = [...units.values()].map((unit) => ({ id: unit.id, rules: [], cases: [], units: [unit] }));
  if (LANGS.some((lang) => spec.languages[lang].barrel.length > 0)) concerns.push({ id: 'index', rules: [], cases: [], units: [] });
  spec.concerns = concerns;
  spec.types = types;

  const pointers = (base: string, item: object): void => {
    for (const what of flagged.get(item) ?? []) handWritten.push(`${base}/${what}`);
  };
  concerns.forEach((concern, ci) =>
    concern.units.forEach((unit, ui) => {
      const ua = `/concerns/${ci}/units/${ui}`;
      pointers(ua, unit);
      unit.members.forEach((member, mi) => pointers(`${ua}/members/${mi}`, member));
    }),
  );
  types.forEach((type, ti) => pointers(`/types/${ti}`, type));
}

export function buildCandidate(root: string, phpAutoload: string, v: Validators): Candidate {
  const specDoc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  if (!v.spec(specDoc)) {
    throw new Error(`SPEC_INVALID ${v.spec.errors?.[0]?.instancePath ?? ''} ${v.spec.errors?.[0]?.message ?? ''}`);
  }
  const spec: Spec = structuredClone(specDoc);
  const sources = readAllSources(root, spec, v, phpAutoload);
  const handWritten: string[] = [];
  const stale: string[] = [];
  if (spec.concerns.length === 0) deriveSpec(spec, sources, handWritten);

  spec.concerns.forEach((concern, ci) => {
    const at = `/concerns/${ci}`;
    handWritten.push(`${at}/rules`, `${at}/cases`, `${at}/units`);
    concern.units.forEach((unit, ui) => {
      const ua = `${at}/units/${ui}`;
      if (unit.only !== undefined) handWritten.push(`${ua}/only`);
      for (const lang of LANGS) {
        const native = unit.native[lang];
        if (native === undefined) continue;
        const found = sources[lang].units.find((u) => u.file === native.file);
        if (found === undefined) stale.push(`${ua}/native/${lang}`);
        else unit.native[lang] = { file: found.file, kind: found.kind, internal: found.internal };
      }
      // A unit that the spec lists without members takes the members of its sources, with their neutral fields to write.
      if (unit.members.length === 0) {
        deriveMembers(unit, sources, (item, what) => {
          const mi = unit.members.indexOf(item);
          handWritten.push(`${ua}/members/${mi < 0 ? unit.members.length : mi}/${what}`);
        });
      }
      unit.members.forEach((member, mi) => {
        const ma = `${ua}/members/${mi}`;
        handWritten.push(`${ma}/inputs`, `${ma}/output`, `${ma}/errors`, `${ma}/state`);
        if (member.only !== undefined) handWritten.push(`${ma}/only`);
        for (const lang of LANGS) {
          const native = member.native[lang];
          if (native === undefined) continue;
          const found = sources[lang].members.find((m) => m.symbol === native.symbol);
          if (found === undefined) stale.push(`${ma}/native/${lang}`);
          else member.native[lang] = { symbol: found.symbol, signature: found.signature };
        }
      });
    });
  });

  spec.types.forEach((type, ti) => {
    const ta = `/types/${ti}`;
    handWritten.push(`${ta}/shape`, `${ta}/unit`);
    if (type.only !== undefined) handWritten.push(`${ta}/only`);
    for (const lang of LANGS) {
      const native = type.native[lang];
      if (native === undefined) continue;
      const found = sources[lang].types.find((t) => `${t.file}::${t.name}` === native.symbol);
      if (found === undefined) stale.push(`${ta}/native/${lang}`);
      else type.native[lang] = { symbol: `${found.file}::${found.name}`, declaration: found.declaration };
    }
  });

  if (!v.spec(spec)) {
    throw new Error(`CANDIDATE_INVALID ${v.spec.errors?.[0]?.instancePath ?? ''} ${v.spec.errors?.[0]?.message ?? ''}`);
  }
  return { spec, handWritten, stale };
}

function main(): number {
  const root = path.resolve(argumentOf('--root') ?? process.cwd());
  const output = path.resolve(argumentOf('--output') ?? path.join(root, 'var', 'recipe', 'interfaces.candidate.json'));
  const autoload = argumentOf('--php-autoload');
  if (autoload === undefined) throw new Error('--php-autoload <autoload.php> is required');
  const phpAutoload = path.resolve(autoload);
  const { spec, handWritten, stale } = buildCandidate(root, phpAutoload, validators());
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(output.replace(/\.json$/u, '.hand-written.json'), `${JSON.stringify(handWritten, null, 2)}\n`);
  for (const pointer of stale) process.stdout.write(`CANDIDATE_STALE ${pointer}: the readers find no such item; kept as the spec has it\n`);
  process.stdout.write(`recipe-candidates: ${output}\n`);
  return 0;
}

function argumentOf(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
