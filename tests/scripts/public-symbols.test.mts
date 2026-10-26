// HY-106, HY-113: public signatures and declarations agree without running unrelated parity bindings.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { findingLine, readDeclaration } from '../../../kit/scripts/kit/parity-declaration.mts';
import { extractSymbols } from '../../../kit/scripts/kit/parity-symbols.mts';
import { missingImplementations, undeclaredPublic } from '../../../kit/scripts/kit/parity-units.mts';
import { checkedFiles } from '../../../kit/scripts/kit/tracked-files.mts';
import { requireBuilt } from './requires.mts';

test('public server symbols match their parity declarations and expose no internal signature types', () => {
  requireBuilt('packages', 'packages/server/ts/dist/index.d.ts');
  const root = resolve('.');
  const declaration = readDeclaration(root, new Set(checkedFiles(root)));
  assert.deepEqual(declaration.errors, []);
  assert.ok(declaration.model);
  const model = declaration.model;
  const extracted = extractSymbols(model, root, { env: process.env, say: (line) => process.stdout.write(`${line}\n`) });
  const findings = [...extracted.findings, ...missingImplementations(model, extracted.snapshots), ...undeclaredPublic(model, extracted.snapshots)];
  assert.deepEqual(findings.map(findingLine), []);
});
