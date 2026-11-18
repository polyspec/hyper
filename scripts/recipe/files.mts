// The check of the files of contracts/interfaces.json that needs no binding, no package install and no reader
// (H35.94, HYR-8): it validates the file against scripts/schema/interfaces.schema.json, and for each unit and language
// it fails a native file that does not exist and a file that declares no class, interface or trait of the unit's name.
// A unit of kind `functions` names a file of functions and declares no class.
// Usage: node scripts/recipe/files.mts [--root <dir>]
// Prints one `CODE message` line per finding and exits 1 on any.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { words } from './names.mts';
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
  let units = 0;
  for (const unit of doc.concerns.flatMap((c) => c.units)) {
    units++;
    for (const [lang, native] of Object.entries(unit.native)) {
      if (native === undefined) continue;
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
  for (const finding of findings) process.stdout.write(`${finding}\n`);
  if (findings.length === 0) process.stdout.write(`recipe-files: ${units} units name files and classes that exist\n`);
  return findings.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
