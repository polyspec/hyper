// Tests the cases of contracts/ that the generated tests of every binding run (HR-100): scripts/binding-cases.mts
// writes a case with one key for each parameter and its result or kind, leaves out a case that the binding decides, and
// puts a case with only into a group whose row names the targets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingCases, type Section } from '../../scripts/binding-cases.mts';

const SECTION: Section = { source: 's.json', group: 'g', member: 'rules.m', args: { value: { call: 'set' } }, result: 'value' };

type Json = Parameters<Parameters<typeof bindingCases>[1]>[0] extends string ? ReturnType<Parameters<typeof bindingCases>[1]> : never;
const run = (cases: Json[]) => bindingCases([SECTION], () => ({ g: cases }));
const ids = (value: Json | undefined) => (Array.isArray(value) ? value.map((kase) => (typeof kase === 'object' && kase !== null && !Array.isArray(kase) ? kase['id'] : null)) : []);

test('a case gives each parameter as a key and its result, or its kind (HR-100)', () => {
  const { files, rows } = run([
    { id: 'a', calls: [['set', ['"x"']]], value: 'x' },
    { id: 'b', calls: [['set', ['403']]], raises: { kind: 'not_allowed', status: null } },
  ]);
  assert.deepEqual(files.get('s.json')?.['g'], [
    { id: 'a', value: 'x', result: 'x' },
    { id: 'b', value: 403, raises: { kind: 'not_allowed' } },
  ]);
  assert.deepEqual(rows, [{ member: 'rules.m', file: 'var/binding-cases/s.json', group: 'g' }]);
});

test('a case of a binding kind, a float, an unsafe integer or two calls is left out (HR-100)', () => {
  const { files } = run([
    { id: 'kept', calls: [['set', ['1']]], value: 1 },
    { id: 'text', calls: [['set', ['"x"']]], raises: { kind: 'invalid_text' } },
    { id: 'float', calls: [['set', ['403.0']]], value: 403 },
    { id: 'unsafe', calls: [['set', ['9007199254740993']]], raises: { kind: 'integer_range' } },
    { id: 'two', calls: [['set', ['1']], ['set', ['2']]], value: 2 },
  ]);
  assert.deepEqual(ids(files.get('s.json')?.['g']), ['kept']);
});

test('a case with only goes to a group whose row names its targets (HR-100)', () => {
  const { rows } = run([
    { id: 'all', calls: [['set', ['1']]], value: 1 },
    { id: 'node', calls: [['set', ['2']]], value: 2, only: { languages: ['node'], sentence: 'HY-1.1' } },
  ]);
  assert.deepEqual(rows.map((row) => [row.group, row.only]), [
    ['g', undefined],
    ['g_only_node_wasm', { targets: ['node', 'wasm'], reason: 'HY-1.1' }],
  ]);
});

test('a section that gives no case fails (HR-100)', () => {
  assert.throws(() => run([{ id: 'two', calls: [], value: null }]), /gives no binding case/);
});
