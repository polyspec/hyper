// The recipe check (HYR-8): validates contracts/interfaces.json, runs the three readers and compares.
// Usage: node scripts/recipe/check.mts [--root <dir>]. Prints one `CODE message` line per finding; exits 1 on any.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { SchemaObject } from 'ajv';
import { compare } from './compare.mts';
import { readSources } from './readers.mts';
import type { Lang, Sources, Spec } from './types.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, '..', 'schema');
const LANGS: Lang[] = ['php', 'node', 'python'];

function readSchema(file: string): SchemaObject {
  const doc: SchemaObject = JSON.parse(readFileSync(path.join(schemaDir, file), 'utf8'));
  return doc;
}

function rootArgument(): string {
  const at = process.argv.indexOf('--root');
  return path.resolve(at < 0 ? process.cwd() : (process.argv[at + 1] ?? process.cwd()));
}

function main(): number {
  const root = rootArgument();
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validateSpec = ajv.compile<Spec>(readSchema('interfaces.schema.json'));
  const validateSources = ajv.compile<Sources>(readSchema('recipe-sources.schema.json'));

  const specDoc: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'interfaces.json'), 'utf8'));
  if (!validateSpec(specDoc)) {
    for (const e of validateSpec.errors ?? []) process.stdout.write(`SPEC_INVALID ${e.instancePath} ${e.message}\n`);
    return 1;
  }
  const spec = specDoc;

  const sources: Record<Lang, Sources> = {
    php: readSources(root, 'php', spec, validateSources),
    node: readSources(root, 'node', spec, validateSources),
    python: readSources(root, 'python', spec, validateSources),
  };
  const protocol = readFileSync(path.join(root, 'docs', 'spec', 'protocol.md'), 'utf8');
  const findings = compare(spec, sources, root, protocol);
  for (const f of findings) process.stdout.write(`${f.code} ${f.message}\n`);
  if (findings.length === 0) process.stdout.write(`recipe-check: ${LANGS.length} languages agree with the spec\n`);
  return findings.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stdout.write(`CHECK_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
