// The reexports of the recipe spec (HYR-5 "Reexports", H35.173): a member that only passes a call to a library member
// is not compared with the sources, and the check fails with REEXPORT_MISSING when the interface.json of the locked
// library crate lists no such member. Each test copies the recipe fixture and writes a stand-in for cargo metadata and
// the interface.json of a library crate into its copy (HR-85).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { track } from '../../scripts/recipe/mutations.mts';
import { isObject } from '../../scripts/recipe/types.mts';
import { validators } from '../../scripts/recipe/validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');
const schemas = validators();

/**
 * The member of the fixture that the tests state as a reexport: a source of each language declares it, so a check that
 * compared it would report it as added, and no section names it and no other member is reached only through it, as a
 * member that only passes a call to a library has no case of hyper and calls no member of hyper.
 */
const MEMBER = 'json-codec.decode';

type Doc = { concerns: { units: { id: string; reexport?: string; members: Record<string, unknown>[] }[] }[] };

function isDoc(v: unknown): v is Doc {
  return isObject(v) && Array.isArray(v.concerns);
}

function readDoc(file: string): Doc {
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isDoc(doc)) throw new Error(`${file} is no spec`);
  return doc;
}

/** The fixture spec with `MEMBER` replaced by `entry`. */
function withMember(doc: Doc, entry: Record<string, unknown>): Doc {
  for (const c of doc.concerns) for (const u of c.units) {
    const at = u.members.findIndex((m) => m.id === MEMBER);
    if (at >= 0) {
      u.members[at] = entry;
      return doc;
    }
  }
  throw new Error(`the fixture spec has no member ${MEMBER}`);
}

/**
 * Runs the check over a copy of the fixture whose spec states `MEMBER` as a reexport of `target`, with a cargo stand-in
 * whose metadata names the crate polyspec-lib, whose interface.json lists the unit `lib_unit` and its member `lib_unit.call`.
 */
function runWith(target: string): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-recipe-reexport-'));
  try {
    cpSync(fixture, root, { recursive: true });
    const specFile = path.join(root, 'contracts', 'interfaces.json');
    writeFileSync(specFile, `${JSON.stringify(withMember(readDoc(specFile), { id: MEMBER, reexport: target }), null, 2)}\n`);
    const crate = path.join(root, 'crate');
    mkdirSync(crate);
    writeFileSync(path.join(crate, 'interface.json'), JSON.stringify({ library: 'lib', units: [{ id: 'lib_unit', members: [{ id: 'lib_unit.call' }] }] }));
    const metadata = JSON.stringify({ packages: [{ name: 'polyspec-lib', manifest_path: path.join(crate, 'Cargo.toml') }] });
    writeFileSync(path.join(root, 'cargo.mjs'), `process.stdout.write(${JSON.stringify(metadata)});\n`);
    track(root);
    return spawnSync(process.execPath, [
      check, '--root', root, '--php-autoload', path.join(root, 'vendor', 'autoload.php'), '--run-dir', path.join(root, 'results'),
      '--cargo', `${process.execPath} ${path.join(root, 'cargo.mjs')}`,
    ], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('HYR-5: a reexport whose library member exists passes and yields no line for that member', () => {
  const result = runWith('lib:lib_unit.call');
  assert.equal(result.stdout.split('\n').filter((l) => l.includes(MEMBER) || l.includes('decode')).join('\n'), '', result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('HYR-5: a reexport whose library member is missing yields REEXPORT_MISSING with the file and the name', () => {
  const result = runWith('lib:lib_unit.absent');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REEXPORT_MISSING member json-codec\.decode reexports lib:lib_unit\.absent, which \S+crate\/interface\.json does not list$/mu);
});

test('HYR-5: a reexport of a library that no locked crate is yields REEXPORT_MISSING', () => {
  const result = runWith('other:lib_unit.call');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REEXPORT_MISSING member json-codec\.decode reexports other:lib_unit\.call; packages\/rust\/Cargo\.toml locks no crate polyspec-other$/mu);
});

test('HYR-5: the schema refuses a reexport member with inputs or native, and a reexport unit with members', () => {
  const doc = (): Doc => readDoc(path.join(fixture, 'contracts', 'interfaces.json'));
  assert.equal(schemas.spec(withMember(doc(), { id: MEMBER, reexport: 'lib:lib_unit.call' })), true, JSON.stringify(schemas.spec.errors));
  assert.equal(schemas.spec(withMember(doc(), { id: MEMBER, reexport: 'lib:lib_unit.call', inputs: [] })), false);
  assert.equal(schemas.spec(withMember(doc(), { id: MEMBER, reexport: 'lib:lib_unit.call', native: { php: { symbol: 'a::b', signature: 'c' } } })), false);
  const unit = doc();
  const [first] = unit.concerns.flatMap((c) => c.units).filter((u) => u.members.length > 0);
  assert.ok(first !== undefined);
  first.reexport = 'lib:lib_unit';
  assert.equal(schemas.spec(unit), false);
  first.members = [];
  assert.equal(schemas.spec(unit), true, JSON.stringify(schemas.spec.errors));
});

/** The python barrel of the fixture, relative to its root. */
const BARREL = path.join('packages', 'python', 'src', 'polyspec', 'hyper', '__init__.py');

/**
 * Runs the check over a copy of the fixture whose python barrel also imports `exported` and whose spec states, when
 * `unit` is given, that entry as a unit of the first concern (HYR-5 Reexports of a unit with `names`). The cargo stand-in
 * names the crate polyspec-lib, whose interface.json lists the variant unit `lib_setting` with the cases server and cluster.
 */
function runWithNames(exported: string[], unit: Record<string, unknown> | undefined): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-recipe-reexport-names-'));
  try {
    cpSync(fixture, root, { recursive: true });
    const specFile = path.join(root, 'contracts', 'interfaces.json');
    const doc = readDoc(specFile);
    if (unit !== undefined) (doc.concerns[0]?.units as unknown[]).push(unit);
    writeFileSync(specFile, `${JSON.stringify(doc, null, 2)}\n`);
    const barrel = path.join(root, BARREL);
    writeFileSync(barrel, `${readFileSync(barrel, 'utf8')}from polyspec.lib import ${exported.join(', ')}\n`);
    const crate = path.join(root, 'crate');
    mkdirSync(crate);
    const setting = { id: 'lib_setting', name: ['lib', 'setting'], kind: 'variant', cases: [{ value: 'server' }, { value: 'cluster' }], members: [] };
    writeFileSync(path.join(crate, 'interface.json'), JSON.stringify({ library: 'lib', units: [setting] }));
    const metadata = JSON.stringify({ packages: [{ name: 'polyspec-lib', manifest_path: path.join(crate, 'Cargo.toml') }] });
    writeFileSync(path.join(root, 'cargo.mjs'), `process.stdout.write(${JSON.stringify(metadata)});\n`);
    track(root);
    return spawnSync(process.execPath, [
      check, '--root', root, '--php-autoload', path.join(root, 'vendor', 'autoload.php'), '--run-dir', path.join(root, 'results'),
      '--cargo', `${process.execPath} ${path.join(root, 'cargo.mjs')}`,
    ], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A unit that the python barrel exports from the library unit `target` under `names`. */
function namesUnit(target: string, names: string[]): Record<string, unknown> {
  return { id: 'lib-setting', reexport: target, names, only: { languages: ['python'], sentence: 'HY-1.1' } };
}

test('HYR-5: without a unit of names, the names that the barrel imports from a library are extra barrel exports', () => {
  const result = runWithNames(['LibSettingServer', 'LibSettingCluster'], undefined);
  assert.match(result.stdout, /^BARREL_EXPORT python barrel exports differ: extra \[LibSettingServer, LibSettingCluster\], missing \[\]$/mu, result.stdout + result.stderr);
});

test('HYR-5: a unit whose library unit and names exist passes and its names are stated in the barrel', () => {
  const result = runWithNames(['LibSettingServer', 'LibSettingCluster'], namesUnit('lib:lib_setting', ['LibSettingServer', 'LibSettingCluster']));
  assert.equal(result.stdout.split('\n').filter((l) => l.includes('BARREL_EXPORT') || l.includes('REEXPORT_MISSING') || l.includes('lib-setting')).join('\n'), '', result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('HYR-5: a unit whose library unit is missing yields REEXPORT_MISSING with the file and the name', () => {
  const result = runWithNames(['LibSettingServer'], namesUnit('lib:absent', ['LibSettingServer']));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REEXPORT_MISSING unit lib-setting reexports lib:absent, which \S+crate\/interface\.json does not list$/mu);
});

test('HYR-5: a name that the library unit does not state yields REEXPORT_MISSING with the file and the name', () => {
  const result = runWithNames(['LibSettingServer', 'LibSettingOther'], namesUnit('lib:lib_setting', ['LibSettingServer', 'LibSettingOther']));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REEXPORT_MISSING unit lib-setting reexports lib:lib_setting as LibSettingOther, which \S+crate\/interface\.json does not state$/mu);
});

test('HYR-5: the schema accepts a unit of names and refuses one with native or members', () => {
  const doc = (unit: Record<string, unknown>): Doc => {
    const d = readDoc(path.join(fixture, 'contracts', 'interfaces.json'));
    (d.concerns[0]?.units as unknown[]).push(unit);
    return d;
  };
  assert.equal(schemas.spec(doc(namesUnit('lib:lib_setting', ['LibSettingServer']))), true, JSON.stringify(schemas.spec.errors));
  assert.equal(schemas.spec(doc({ ...namesUnit('lib:lib_setting', ['LibSettingServer']), members: [] })), false);
  assert.equal(schemas.spec(doc({ ...namesUnit('lib:lib_setting', ['LibSettingServer']), native: {} })), false);
  assert.equal(schemas.spec(doc({ ...namesUnit('lib:lib_setting', []) })), false);
});
