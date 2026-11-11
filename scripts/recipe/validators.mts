// The compiled schemas of the recipe (scripts/schema): the development spec and the readers' output.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { SchemaObject } from 'ajv';
import type { Validators } from './run.mts';
import type { Sources, Spec } from './types.mts';

const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');

function readSchema(file: string): SchemaObject {
  const doc: SchemaObject = JSON.parse(readFileSync(path.join(schemaDir, file), 'utf8'));
  return doc;
}

export function validators(): Validators {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return {
    spec: ajv.compile<Spec>(readSchema('interfaces.schema.json')),
    sources: ajv.compile<Sources>(readSchema('recipe-sources.schema.json')),
  };
}
