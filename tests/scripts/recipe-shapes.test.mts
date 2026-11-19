// The union shape of a type (HYR-5): a `union` lists the vocabulary terms of the members of a union type. The check passes
// a declaration whose members are those terms, and fails a declaration whose members differ in number or in term.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ctx } from '../../scripts/recipe/context.mts';
import { expectedVisibility } from '../../scripts/recipe/names.mts';
import { checkShapes } from '../../scripts/recipe/shapes.mts';
import { emptySources, type Lang, type Sources, type Spec } from '../../scripts/recipe/types.mts';

const FILE = 'src/value-kind.ts';
const DECLARATION = "type ValueKind = 'string' | 'int' | Token;";

/** The spec of one type `valueKind` of the unit `token` with the given shape; the type is declared in node only. */
function specWith(shape: Record<string, unknown>, id = 'valueKind'): Spec {
  return {
    schema: 1,
    concerns: [{ id: 'token', units: [{ id: 'token', native: {}, members: [] }] }],
    types: [{ id, visibility: 'public', unit: 'token', shape, only: { languages: ['node'], sentence: 'HY-44.6' }, native: { node: { symbol: `${FILE}::ValueKind`, declaration: DECLARATION } } }],
  } as unknown as Spec;
}

/** The findings of the shape check, by code, for a node declaration with the given members (none for a non-union). */
function codes(spec: Spec, members: string[] | undefined): string[] {
  const found: string[] = [];
  const type = {
    file: FILE,
    name: 'ValueKind',
    visibility: expectedVisibility('node', 'public'),
    declaration: DECLARATION,
    ...(members === undefined ? {} : { members }),
  };
  const sources = {
    php: emptySources('php'),
    python: emptySources('python'),
    node: { ...emptySources('node'), types: [type] },
  } as unknown as Record<Lang, Sources>;
  const ctx: Ctx = {
    spec,
    root: '',
    protocol: { rules: new Map(), retiredRules: new Set(), terms: new Set(['string', 'int']), statuses: '' } as unknown as Ctx['protocol'],
    sources,
    readDir: () => {
      throw new Error('the shape check reads no directory');
    },
    add: (code) => {
      found.push(code);
    },
  };
  checkShapes(ctx);
  return found;
}

test('a union shape whose terms are the members of the declared union passes', () => {
  assert.deepEqual(codes(specWith({ union: ['string', 'int', 'token'] }), ['string', 'int', 'Token']), []);
});

test('a union shape that differs from the declared union fails with TYPE_SHAPE', () => {
  assert.ok(codes(specWith({ union: ['string', 'int', 'token'] }), ['string', 'int']).includes('TYPE_SHAPE'), 'a member is missing');
  assert.ok(codes(specWith({ union: ['string', 'int', 'token'] }), ['string', 'int', 'Other']).includes('TYPE_SHAPE'), 'a member differs');
});

test('a union shape on a declaration that is not a union fails with TYPE_SHAPE', () => {
  assert.ok(codes(specWith({ union: ['string', 'int', 'token'] }), undefined).includes('TYPE_SHAPE'));
});

test('a recursive union names its own id as a member and passes', () => {
  assert.deepEqual(codes(specWith({ union: ['string', 'valueKind'] }), ['string', 'ValueKind']), []);
});

test('a union term outside the vocabulary fails with TERM_UNKNOWN', () => {
  assert.ok(codes(specWith({ union: ['string', 'nope'] }), ['string', 'Nope']).includes('TERM_UNKNOWN'));
});
