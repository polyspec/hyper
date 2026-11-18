// The check of the files of contracts/interfaces.json that needs no binding, no package install and no reader
// (H35.94, HYR-8): it validates the file against scripts/schema/interfaces.schema.json, and for each unit and language
// it fails a native file that does not exist and a file that declares no class, interface or trait of the unit's name.
// A unit of kind `functions` names a file of functions and declares no class. An extension unit (HYR-5) names a class
// of the hyper extension and no file, lists no members, and an error `<unit>:<kind>` names such a unit and a kind that a
// statement of contracts/protocol.json names.
// Usage: node scripts/recipe/files.mts [--root <dir>]
// Prints one `CODE message` line per finding and exits 1 on any.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { report, runCommand } from './exit.mts';
import { words } from './names.mts';
import { readProtocol } from './protocol.mts';
import { validators } from './validators.mts';

/** The names that a source file declares as a class, an interface, a trait or an enum, in PHP, TypeScript and Python. */
function declared(text: string): string[] {
  return [...text.matchAll(/^[ \t]*(?:export[ \t]+)?(?:(?:final|abstract|readonly|declare)[ \t]+)*(?:class|interface|trait|enum)[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gmu)].map(
    (match) => match[1] ?? '',
  );
}

function main(): number {
  const at = process.argv.indexOf('--root');
  const root = path.resolve(at < 0 ? process.cwd() : (process.argv[at + 1] ?? '.'));
  const file = path.join(root, 'contracts', 'interfaces.json');
  // HR-89: the progress goes to the standard error, so the standard output holds the findings alone.
  process.stderr.write(`recipe-files: ${file} names the files and classes of its units under ${root}\n`);
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const v = validators();
  if (!v.spec(doc)) {
    for (const e of v.spec.errors ?? []) process.stdout.write(`SPEC_INVALID ${e.instancePath} ${e.message ?? ''}\n`);
    return 1;
  }
  const findings: string[] = [];
  const all = doc.concerns.flatMap((c) => c.units);
  const extensions = new Set(all.filter((u) => Object.values(u.native).some((n) => n !== undefined && 'extension' in n)).map((u) => u.id));
  const statuses = readProtocol(readFileSync(path.join(root, 'contracts', 'protocol.json'), 'utf8')).statuses.replace(/\s+/gu, ' ');
  let units = 0;
  for (const unit of all) {
    units++;
    if (extensions.has(unit.id) && unit.members.length > 0) {
      findings.push(`EXTENSION_MEMBERS unit ${unit.id} is an extension class and lists ${unit.members.length} members`);
    }
    for (const member of unit.members) {
      for (const error of member.errors) {
        const at = error.indexOf(':');
        if (at < 0) continue;
        const [owner, kind] = [error.slice(0, at), error.slice(at + 1)];
        if (!extensions.has(owner)) findings.push(`ERROR_UNIT_UNKNOWN ${member.id} error ${error} names ${owner}, which is no extension unit`);
        else if (!new RegExp(`\\b${kind}\\b`, 'u').test(statuses)) {
          findings.push(`ERROR_KIND_UNKNOWN ${member.id} error ${error} names a kind that no statement of protocol.json names`);
        }
      }
    }
    for (const [lang, native] of Object.entries(unit.native)) {
      if (native === undefined || 'extension' in native) continue;
      const source = path.join(root, native.file);
      if (!existsSync(source)) {
        findings.push(`UNIT_FILE_MISSING unit ${unit.id} names ${lang} ${native.file}, which does not exist`);
        continue;
      }
      if (native.kind === 'functions') continue;
      const names = declared(readFileSync(source, 'utf8'));
      if (!names.some((name) => words(name) === unit.id)) {
        const expected = unit.id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        findings.push(`UNIT_CLASS_MISSING unit ${unit.id} names ${lang} ${native.file}, which declares no class, interface or trait ${expected}`);
      }
    }
  }
  return report(findings, `recipe-files: ${units} units name files and classes that exist`);
}

runCommand(main);
