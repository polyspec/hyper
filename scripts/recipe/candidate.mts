// The candidate of the development spec (HYR-10): the spec with its native fields refreshed from the readers. The
// hand-written fields (neutral fields, concern fields, unit grouping, `only`, type shape) keep their values; their JSON
// pointers go to a sidecar file, so that the reviewed change of the spec can tell them apart from the native fields.
// Usage: node scripts/recipe/candidate.mts [--root <dir>] [--output <file>]
// Prints `CANDIDATE_STALE <pointer>` for each native item that the readers no longer find.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readAllSources, type Validators } from './run.mts';
import { LANGS, type Spec } from './types.mts';
import { validators } from './validators.mts';

export type Candidate = { spec: Spec; handWritten: string[]; stale: string[] };

export function buildCandidate(root: string, v: Validators): Candidate {
  const specDoc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  if (!v.spec(specDoc)) {
    throw new Error(`SPEC_INVALID ${v.spec.errors?.[0]?.instancePath ?? ''} ${v.spec.errors?.[0]?.message ?? ''}`);
  }
  const spec: Spec = structuredClone(specDoc);
  const sources = readAllSources(root, spec, v);
  const handWritten: string[] = [];
  const stale: string[] = [];

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
      const found = sources[lang].types.find((t) => t.name === native.symbol);
      if (found === undefined) stale.push(`${ta}/native/${lang}`);
      else type.native[lang] = { symbol: found.name, declaration: found.declaration };
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
  const { spec, handWritten, stale } = buildCandidate(root, validators());
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
