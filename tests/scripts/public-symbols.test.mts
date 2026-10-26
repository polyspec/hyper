// HY-106, HY-113: installed native symbol checks cover declarations without running unrelated parity bindings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { kitModule } from './kit-tools.mts';
import { requireBuilt } from './requires.mts';

test('public server symbols match their parity declarations and expose no internal signature types', () => {
  requireBuilt('packages', 'packages/server/ts/dist/index.d.ts');
  // The installed package selects source or packed modules; Node executes the native checks in that mode.
  const script = `
    import assert from 'node:assert/strict';
    import { findingLine, readDeclaration } from ${JSON.stringify(kitModule('parity-declaration').href)};
    import { extractSymbols } from ${JSON.stringify(kitModule('parity-symbols').href)};
    import { missingImplementations, undeclaredPublic } from ${JSON.stringify(kitModule('parity-units').href)};
    import { checkedFiles } from ${JSON.stringify(kitModule('tracked-files').href)};
    const root = process.cwd();
    const declaration = readDeclaration(root, new Set(checkedFiles(root)));
    assert.deepEqual(declaration.errors, []);
    assert.ok(declaration.model);
    const extracted = extractSymbols(declaration.model, root, { env: process.env, say: console.log });
    assert.equal(extracted.snapshots.size, 3);
    for (const symbols of extracted.snapshots.values()) assert.ok(symbols.size > 0);
    const findings = [...extracted.findings, ...missingImplementations(declaration.model, extracted.snapshots), ...undeclaredPublic(declaration.model, extracted.snapshots)];
    assert.deepEqual(findings.map(findingLine), []);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: resolve('.'), encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
