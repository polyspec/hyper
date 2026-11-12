// Files and units of the recipe check (HYR-3, HYR-4): every file is owned by a unit or a barrel, every unit is where the
// spec says with its kind and visibility, in the directory of its group, and each file holds one unit.

import { LANGS } from './types.mts';
import type { Ctx } from './context.mts';
import { expectedDirectory, expectedFile, words } from './names.mts';
import { checkOnly } from './members.mts';

export function checkUnits(ctx: Ctx): void {
  const { spec, sources, add } = ctx;
  const units = spec.concerns.flatMap((c) => c.units);
  const inits = checkGroups(ctx);
  for (const lang of LANGS) {
    const owned = new Set<string>([...spec.languages[lang].barrel, ...(lang === 'python' ? inits : [])]);
    const ownedBy = new Map<string, string>();
    for (const u of units) {
      const n = u.native[lang];
      if (!n) continue;
      owned.add(n.file);
      const other = ownedBy.get(n.file);
      if (other !== undefined && other !== u.id) add('FILE_SHARED', `${lang} file ${n.file} is named by units ${other} and ${u.id}`);
      ownedBy.set(n.file, u.id);
    }
    for (const f of sources[lang].files) if (!owned.has(f)) add('FILE_UNOWNED', `${lang} file ${f} is named by no unit or barrel`);
    for (const f of owned) if (!sources[lang].files.includes(f)) add('FILE_MISSING', `${lang} file ${f} is named by the spec and missing`);

    // HYR-4: a file holds one unit; a Node interface is a type, not a unit, in this count.
    const perFile = new Map<string, number>();
    for (const r of sources[lang].units) if (r.kind !== 'interface') perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1);
    for (const [file, count] of perFile) if (count > 1) add('FILE_UNITS', `${lang} file ${file} holds ${count} units; HYR-4 allows one`);
  }
  for (const c of spec.concerns) for (const u of c.units) {
    checkOnly(add, `unit ${u.id}`, u.native, LANGS, u.only);
    for (const lang of LANGS) {
      const n = u.native[lang];
      if (!n) continue;
      const candidates = sources[lang].units.filter((r) => words(r.name) === u.id);
      const found = candidates.find((r) => r.file === n.file);
      if (found === undefined) {
        add(candidates.length > 0 ? 'UNIT_FILE' : 'UNIT_MISSING', `${lang} unit ${u.id} is not in ${n.file}`);
      } else {
        if (found.kind !== n.kind) add('UNIT_KIND', `${lang} unit ${u.id} is ${found.kind}, spec says ${n.kind}`);
        if (found.internal !== n.internal) add('UNIT_VISIBILITY', `${lang} unit ${u.id} internal=${found.internal}, spec says ${n.internal}`);
      }
      const base = n.file.split('/').pop() ?? '';
      if (base !== expectedFile(lang, u.id, n.internal)) add('UNIT_FILE', `${lang} unit ${u.id} file ${base} should be ${expectedFile(lang, u.id, n.internal)}`);
      if (c.group !== undefined && spec.groups.includes(c.group)) {
        const root = spec.languages[lang].sources.find((r) => n.file.startsWith(`${r}/`)) ?? spec.languages[lang].sources[0] ?? '';
        const expected = `${root}/${expectedDirectory(lang, c.group)}/${base}`;
        if (n.file !== expected) add('UNIT_DIRECTORY', `${lang} unit ${u.id} is at ${n.file}; HYR-4 puts it at ${expected}, the directory of the group ${c.group}`);
      }
    }
  }
  for (const lang of LANGS) {
    const listed = new Set(units.filter((u) => u.native[lang]).map((u) => u.id));
    for (const r of sources[lang].units) {
      if (r.kind !== 'interface' && !listed.has(words(r.name))) add('UNIT_COUNT', `${lang} ${r.file} declares unit ${r.name} that the spec does not list`);
    }
  }
}

/**
 * HYR-2, HYR-4: every concern with a unit names a group of `groups`, a concern without one names none, and every group
 * is named. Each group directory that holds a Python unit holds an `__init__.py` with no statement besides its
 * docstring; the paths of those files are returned, which the check of the files owns.
 */
function checkGroups(ctx: Ctx): string[] {
  const { spec, sources, add } = ctx;
  for (const c of spec.concerns) {
    if (c.units.length > 0 && (c.group === undefined || !spec.groups.includes(c.group))) {
      add('GROUP_UNKNOWN', `concern ${c.id} names the group ${c.group ?? '(none)'}, which is not one of groups (${spec.groups.join(', ')})`);
    }
    if (c.units.length === 0 && c.group !== undefined) add('GROUP_UNKNOWN', `concern ${c.id} has no unit and names the group ${c.group}`);
  }
  for (const g of spec.groups) if (!spec.concerns.some((c) => c.group === g)) add('GROUP_UNUSED', `group ${g} is named by no concern`);
  const inits: string[] = [];
  const [root] = spec.languages.python.sources;
  if (root === undefined) return inits;
  for (const g of spec.groups) {
    if (!spec.concerns.some((c) => c.group === g && c.units.some((u) => u.native.python !== undefined))) continue;
    const init = `${root}/${expectedDirectory('python', g)}/__init__.py`;
    inits.push(init);
    const py = sources.python;
    const held = [...py.exports, ...py.units, ...py.members, ...py.constants, ...py.types, ...py.uses].filter((x) => x.file === init);
    if (held.length > 0) add('GROUP_INIT', `python ${init} declares or imports ${held.map((x) => x.name).join(', ')}; HYR-4 allows a docstring only`);
  }
  return inits;
}
