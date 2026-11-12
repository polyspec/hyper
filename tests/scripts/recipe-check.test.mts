// The recipe check (HYR-8) over the fixture tree of fixtures/recipe: the fixture passes with its mutation cases, and each
// mutation of fixtures/recipe/mutations.json fails the check with the finding code that the mutation names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { applyMutation, readMutations, track } from '../../scripts/recipe/mutations.mts';
import { checkStated } from '../../scripts/recipe/stated.mts';
import { expectedDirectory } from '../../scripts/recipe/names.mts';
import { emptySources, type ClassRef, type Expr, type Lang, type Member, type Parameter, type Scope, type SourceClass, type Sources, type Spec, type Unit } from '../../scripts/recipe/types.mts';
import { validators } from '../../scripts/recipe/validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');
const candidate = path.join(repo, 'scripts', 'recipe', 'candidate.mts');
/** The PHP autoloader of a recipe tree: the fixture's stand-in for the server's Composer autoloader. */
const phpAutoload = (root: string): string => path.join(root, 'vendor', 'autoload.php');

test('the schema term is the vocabulary: a status number is not a term', () => {
  const text = readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8');
  const spec = schemas.spec;
  assert.equal(spec(JSON.parse(text)), true);
  assert.equal(spec(JSON.parse(text.replace('"output": "string",', '"output": "404",'))), false);
});

const mutations = readMutations(path.join(fixture, 'mutations.json'));

function resultArguments(root: string): string[] {
  return ['php', 'node', 'python', 'browser', 'build'].flatMap((lang) => ['--results', `${lang}=${path.join(root, 'results', `${lang}.txt`)}`]);
}

/** Runs the check over a tree without its self test, after it made every file of the tree a tracked one. */
function checkOf(root: string): { status: number | null; output: string } {
  track(root);
  const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

/** Runs `run` with a copy of the fixture and a function that replaces a text of one of its files, and removes the copy. */
function withFixtureCopy(prefix: string, run: (root: string, replaceIn: (file: string, from: string, to: string) => void) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const replaceIn = (file: string, from: string, to: string): void => {
    const target = path.join(root, file);
    const text = readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `${file} lacks ${JSON.stringify(from)}`);
    writeFileSync(target, text.replace(from, to));
  };
  try {
    cpSync(fixture, root, { recursive: true });
    run(root, replaceIn);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const schemas = validators();

/** The spec of a file, which must pass the schema of the spec. */
function specOf(file: string): Spec {
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!schemas.spec(doc)) throw new Error(`${file} is no spec: ${JSON.stringify(schemas.spec.errors?.[0])}`);
  return doc;
}

/** The unit `id` of the spec of a tree, and a function that writes the spec back. */
function unitOf(root: string, id: string): { spec: Spec; unit: Unit; write: () => void } {
  const file = path.join(root, 'contracts', 'interfaces.json');
  const spec = specOf(file);
  const unit = spec.concerns.flatMap((c) => c.units).find((u) => u.id === id);
  if (unit === undefined) throw new Error(`the fixture has no unit ${id}`);
  return { spec, unit, write: () => { writeFileSync(file, JSON.stringify(spec, null, 2)); } };
}

/** The value at a path of a parsed JSON document, or undefined where a step is missing. */
function at(doc: unknown, ...steps: (string | number)[]): unknown {
  let node: unknown = doc;
  for (const step of steps) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Reflect.get(node, step);
  }
  return node;
}

/** The list at a path of a parsed JSON document; a value that is no list fails. */
function listAt(doc: unknown, ...steps: (string | number)[]): unknown[] {
  const list = at(doc, ...steps);
  if (!Array.isArray(list)) throw new Error(`${steps.join('/')} is no list`);
  const items: unknown[] = list;
  return items;
}

/** The keys of the object at a path of a parsed JSON document; a value that is no object has none. */
function keysAt(doc: unknown, ...steps: (string | number)[]): string[] {
  const node = at(doc, ...steps);
  return typeof node === 'object' && node !== null ? Object.keys(node) : [];
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

test('the fixture passes the recipe check, with its mutation cases first', () => {
  const result = spawnSync(process.execPath, [check, '--root', fixture, '--php-autoload', phpAutoload(fixture), ...resultArguments(fixture)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a sentence may cite a statement of an HYC rule of protocol.json', () => {
  withFixtureCopy('recipe-hyc-', (root) => {
    applyMutation(root, { id: 'hyc-sentence', file: 'contracts/interfaces.json', from: '"sentence": "HY-1.1",', to: '"sentence": "HYC-1.1",', code: 'SENTENCE_UNKNOWN' });
    const { status, output } = checkOf(root);
    assert.doesNotMatch(output, /\bSENTENCE_UNKNOWN\b/);
    assert.equal(status, 0, output);
  });
});

test('a constructor of each case reader is one member, whatever the language calls it and whatever its visibility', () => {
  withFixtureCopy('recipe-ctor-', (root, replaceIn) => {
    replaceIn('packages/server/php/tests/CaseReader.php', '    public function cases(): array', '    private function __construct()\n    {\n    }\n\n    public function cases(): array');
    replaceIn('packages/server/python/tests/case_reader.py', '    def cases(self):', '    def __init__(self):\n        pass\n\n    def cases(self):');
    replaceIn('packages/server/ts/tests/case-reader.ts', '  cases(): unknown[] {', '  constructor() {}\n\n  cases(): unknown[] {');
    const { status, output } = checkOf(root);
    assert.doesNotMatch(output, /\bCASE_READER_MEMBERS\b/);
    assert.equal(status, 0, output);
  });
});

test('an internal member of a public Python module is named with a leading underscore', () => {
  withFixtureCopy('recipe-internal-', (root, replaceIn) => {
    // The essence calls the new member, so that a stated member reaches it (HYR-5).
    replaceIn('packages/server/php/src/Representation/MediaType.php', "return $this->folded(new Csrf('k'));", "return $this->folded(new Csrf('k')) . $this->label();");
    replaceIn('packages/server/php/src/Representation/MediaType.php', "        return $csrf->raw();\n    }\n", "        return $csrf->raw();\n    }\n\n    /** @internal */\n    public function label(): string\n    {\n        return 'html';\n    }\n");
    replaceIn('packages/server/ts/src/representation/media-type.ts', "return this.folded(new Csrf('k'));", "return this.folded(new Csrf('k')) + this.label();");
    replaceIn('packages/server/ts/src/representation/media-type.ts', "    return csrf.raw();\n  }\n", "    return csrf.raw();\n  }\n\n  /** @internal */\n  label(): string {\n    return 'html';\n  }\n");
    replaceIn('packages/server/python/src/polyspec/hyper/representation/media_type.py', 'return self._folded(Csrf("k"))', 'return self._folded(Csrf("k")) + self._label()');
    replaceIn('packages/server/python/src/polyspec/hyper/representation/media_type.py', '        return csrf.raw()\n', '        return csrf.raw()\n\n    def _label(self) -> str:\n        return "html"\n');
    const { unit, write } = unitOf(root, 'media-type');
    unit.members.push({
      id: 'media-type.label',
      kind: 'method',
      visibility: 'internal',
      inputs: [],
      output: 'string',
      errors: [],
      state: 'Returns the label.',
      native: {
        php: { symbol: 'packages/server/php/src/Representation/MediaType.php::Polyspec\\Hyper\\MediaType::label', signature: 'public function label(): string' },
        node: { symbol: 'packages/server/ts/src/representation/media-type.ts::MediaType.label', signature: 'label(): string' },
        python: { symbol: 'packages/server/python/src/polyspec/hyper/representation/media_type.py::MediaType._label', signature: 'def _label(self) -> str' },
      },
    });
    write();
    const { status, output } = checkOf(root);
    assert.doesNotMatch(output, /\bMEMBER_NAME\b/);
    assert.equal(status, 0, output);
  });
});

test('a Python parameter named cls or self after the receiver is an input', () => {
  withFixtureCopy('recipe-receiver-', (root, replaceIn) => {
    // The member is internal and the essence calls it, so that a stated member reaches it (HYR-5).
    replaceIn('packages/server/php/src/Representation/MediaType.php', "return $this->folded(new Csrf('k'));", "return $this->folded(new Csrf('k')) . $this->named('x');");
    replaceIn('packages/server/php/src/Representation/MediaType.php', "        return $csrf->raw();\n    }\n", "        return $csrf->raw();\n    }\n\n    /** @internal */\n    public function named(string $cls): string\n    {\n        return $cls;\n    }\n");
    replaceIn('packages/server/ts/src/representation/media-type.ts', "return this.folded(new Csrf('k'));", "return this.folded(new Csrf('k')) + this.named('x');");
    replaceIn('packages/server/ts/src/representation/media-type.ts', "    return csrf.raw();\n  }\n", "    return csrf.raw();\n  }\n\n  /** @internal */\n  named(cls: string): string {\n    return cls;\n  }\n");
    replaceIn('packages/server/python/src/polyspec/hyper/representation/media_type.py', 'return self._folded(Csrf("k"))', 'return self._folded(Csrf("k")) + self._named("x")');
    replaceIn('packages/server/python/src/polyspec/hyper/representation/media_type.py', '        return csrf.raw()\n', '        return csrf.raw()\n\n    def _named(self, cls: str) -> str:\n        return cls\n');
    const { unit, write } = unitOf(root, 'media-type');
    unit.members.push({
      id: 'media-type.named',
      kind: 'method',
      visibility: 'internal',
      inputs: ['string'],
      output: 'string',
      errors: [],
      state: 'Returns the name.',
      native: {
        php: { symbol: 'packages/server/php/src/Representation/MediaType.php::Polyspec\\Hyper\\MediaType::named', signature: 'public function named(string $cls): string' },
        node: { symbol: 'packages/server/ts/src/representation/media-type.ts::MediaType.named', signature: 'named(cls: string): string' },
        python: { symbol: 'packages/server/python/src/polyspec/hyper/representation/media_type.py::MediaType._named', signature: 'def _named(self, cls: str) -> str' },
      },
    });
    write();
    const { status, output } = checkOf(root);
    assert.doesNotMatch(output, /\bMEMBER_SIGNATURE\b/);
    assert.equal(status, 0, output);
  });
});

test('the candidate refreshes the native fields and lists the hand-written ones', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-candidate-'));
  try {
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', fixture, '--php-autoload', phpAutoload(fixture), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(at(readJson(output), 'schema'), 1);
    const handWritten = listAt(readJson(path.join(dir, 'interfaces.candidate.hand-written.json')));
    assert.ok(handWritten.includes('/concerns/0/rules'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the candidate derives the units and concerns from an empty skeleton', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-skeleton-'));
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-skeleton-root-'));
  try {
    cpSync(fixture, root, { recursive: true });
    track(root);
    const spec = specOf(path.join(fixture, 'contracts', 'interfaces.json'));
    writeFileSync(path.join(root, 'contracts', 'interfaces.json'), JSON.stringify({ ...spec, outside: [], concerns: [], types: [] }));
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', root, '--php-autoload', phpAutoload(root), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const csrf = listAt(readJson(output), 'concerns').find((c) => at(c, 'id') === 'csrf');
    assert.ok(csrf !== undefined, 'no concern csrf');
    assert.deepEqual(keysAt(csrf, 'units', 0, 'native').sort(), ['node', 'php', 'python']);
    // HYR-4: the group of a derived concern is the directory of its files, and the groups are those of the concerns.
    assert.equal(at(csrf, 'group'), 'session');
    assert.deepEqual(listAt(readJson(output), 'groups'), ['representation', 'session']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('the candidate derives the members of a unit that the spec lists without members', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-members-'));
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-members-root-'));
  try {
    cpSync(fixture, root, { recursive: true });
    track(root);
    const spec = specOf(path.join(fixture, 'contracts', 'interfaces.json'));
    const csrf = spec.concerns.find((c) => c.id === 'csrf');
    assert.ok(csrf?.units[0] !== undefined, 'the fixture has no unit of csrf');
    const expected = csrf.units[0].members.length;
    csrf.units[0].members = [];
    writeFileSync(path.join(root, 'contracts', 'interfaces.json'), JSON.stringify(spec));
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', root, '--php-autoload', phpAutoload(root), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const derived = listAt(readJson(output), 'concerns').find((c) => at(c, 'id') === 'csrf');
    const members = listAt(derived, 'units', 0, 'members');
    assert.ok(expected > 0, 'the fixture unit of csrf has no members');
    assert.equal(members.length, expected);
    assert.ok(members.every((m) => keysAt(m, 'native').length > 0), 'a derived member names no native symbol');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

for (const m of mutations) {
  test(`mutation ${m.id} fails with ${m.code}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recipe-mutation-'));
    try {
      cpSync(fixture, root, { recursive: true });
      applyMutation(root, m);
      const { status, output } = checkOf(root);
      assert.notEqual(status, 0, `mutation ${m.id} passed the check`);
      assert.match(output, new RegExp(`\\b${m.code}\\b`));
      if (m.forbid !== undefined) assert.doesNotMatch(output, new RegExp(`\\b${m.forbid}\\b`));
      if (m.detail !== undefined) assert.ok(output.includes(m.detail), `mutation ${m.id}: output lacks ${m.detail}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// The readers' own output for a tree, as the check reads it (HYR-8): it passes the schema of the reader output.

const readerCommands: Record<'php' | 'node' | 'python', (root: string) => [string, string[]]> = {
  php: (root) => [process.env.RECIPE_PHP ?? 'php', [path.join(repo, 'scripts', 'recipe', 'read-php.php'), root, '--autoload', path.join(root, 'autoload.php')]],
  node: (root) => [process.execPath, [path.join(repo, 'scripts', 'recipe', 'read-node.mts'), root]],
  python: (root) => [process.env.RECIPE_PYTHON ?? 'python3', [path.join(repo, 'scripts', 'recipe', 'read_python.py'), root]],
};
// Runs the reader of a language with the arguments and returns its output, which the schema of the reader output checks.
function runReader(lang: 'php' | 'node' | 'python', bin: string, args: string[]): Sources {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const out: unknown = JSON.parse(result.stdout);
  if (!schemas.sources(out)) throw new Error(`the ${lang} reader printed no reader output: ${JSON.stringify(schemas.sources.errors?.[0])}`);
  return out;
}
function readFixture(lang: 'php' | 'node' | 'python', root: string): Sources {
  const [bin, prefix] = readerCommands[lang](root);
  return runReader(lang, bin, [...prefix, '--sources', 'src', '--tests', 'tests']);
}
const readPython = (root: string): Sources => readFixture('python', root);

test('the Python reader records the names an import binds, and its aliases', () => {
  const names = readPython(path.join(fixture, 'readers', 'python')).uses.filter((u) => u.file === 'src/app.py').map((u) => u.name);
  for (const name of ['_secret', 'shown', 'tools', '_util', 'util']) assert.ok(names.includes(name), `${name} is not a use of src/app.py: ${names.join(', ')}`);
});

test('the Python reader records annotated and unpacked module constants', () => {
  const names = readPython(path.join(fixture, 'readers', 'python')).constants.filter((c) => c.file === 'src/limits.py').map((c) => c.name);
  for (const name of ['LIMIT', 'LOW', 'HIGH']) assert.ok(names.includes(name), `${name} is not a constant of src/limits.py: ${names.join(', ')}`);
});

test('the Python reader takes the module-level, async and pytest-style tests of every file under the test roots', () => {
  const tests = readPython(path.join(fixture, 'readers', 'python')).tests.map((t) => `${t.file}::${t.name}`);
  for (const test of ['tests/test_module.py::test_plain', 'tests/test_module.py::test_async', 'tests/extra/helpers.py::test_helper', 'tests/test_widget.py::TestWidget.test_size']) {
    assert.ok(tests.includes(test), `${test} is not a test: ${tests.join(', ')}`);
  }
});

test('the Python reader lists the inherited tests of a class whose base is a test case of another file', () => {
  const tests = readPython(path.join(fixture, 'readers', 'python')).tests.map((t) => `${t.file}::${t.name}`);
  // The class runs its own test and the test of the class without a test case that it extends, each once.
  assert.deepEqual(tests.filter((t) => t.startsWith('tests/test_derived.py::')), ['tests/test_derived.py::DerivedTest.test_own', 'tests/test_derived.py::DerivedTest.test_mixed'], `tests: ${tests.join(', ')}`);
  // The file that declares the bases holds no test: its test case has none, and its other class is no test case.
  assert.deepEqual(tests.filter((t) => t.startsWith('tests/base_case.py::')), [], `tests: ${tests.join(', ')}`);
});

test('the readers list only the public and internal properties of a class as members', () => {
  const hidden: Record<'php' | 'node' | 'python', string[]> = { php: ['hidden', 'guarded'], node: ['hidden', 'guarded'], python: ['__secret'] };
  for (const lang of ['php', 'node', 'python'] as const) {
    const names = readFixture(lang, path.join(fixture, 'readers', lang)).members.filter((m) => m.unit === 'Widget').map((m) => m.name);
    assert.ok(names.includes('size'), `${lang} does not list size: ${names.join(', ')}`);
    for (const name of hidden[lang]) assert.ok(!names.includes(name), `${lang} lists ${name} as a member: ${names.join(', ')}`);
  }
  // A Python property with one leading underscore is internal; one with two is private to its class (HYR-8).
  const cache = readPython(path.join(fixture, 'readers', 'python')).members.find((m) => m.unit === 'Widget' && m.name === '_cache');
  assert.equal(cache?.visibility, 'internal', 'python does not list _cache as an internal member');
});

test('the Python reader records a call of an imported name by its original name and module, and no call of a local name', () => {
  const calls = readPython(path.join(fixture, 'readers', 'python')).calls.filter((c) => c.file === 'src/maker.py').map((c) => `${c.module}:${c.name}`);
  assert.deepEqual(calls.sort(), ['widget:Widget', 'widget:Widget', 'widget:Widget'], `python records the calls of src/maker.py as ${calls.join(', ')}`);
});

test('the Python reader counts a variadic parameter as one input, as PHP and Node do', () => {
  const grow = readPython(path.join(fixture, 'readers', 'python')).members.find((m) => m.unit === 'Widget' && m.name === 'grow');
  assert.deepEqual(grow?.parameters, ['sizes'], `python reads the parameters of grow as ${JSON.stringify(grow?.parameters)}`);
});

test('the PHP reader lists a trait member under the trait, not under the class that uses it', () => {
  const names = readFixture('php', path.join(fixture, 'readers', 'php')).members.filter((m) => m.unit === 'Gadget').map((m) => m.name);
  assert.ok(names.includes('size'), `Gadget does not list size: ${names.join(', ')}`);
  for (const name of ['label', 'describe']) assert.ok(!names.includes(name), `Gadget lists the trait member ${name}: ${names.join(', ')}`);
});

test('the PHP reader reads @internal as a tag of a docblock line, not as a word in a comment', () => {
  const out = readFixture('php', path.join(fixture, 'readers', 'php'));
  assert.equal(out.units.find((u) => u.name === 'Tagged')?.internal, false, 'Tagged is internal by a word in its docblock');
  assert.equal(out.members.find((m) => m.unit === 'Tagged' && m.name === 'size')?.visibility, 'public', 'Tagged::size is not public');
  assert.equal(out.units.find((u) => u.name === 'Sealed')?.internal, true, 'Sealed has the @internal tag but is not internal');
});

test('a PHP class of static methods is a functions unit, whatever its properties', () => {
  const kind = readFixture('php', path.join(fixture, 'readers', 'php')).units.find((u) => u.name === 'Helpers')?.kind;
  assert.equal(kind, 'functions', `Helpers is a ${kind} unit`);
});

test('a PHP class of static methods that extends another class is a class unit', () => {
  const kind = readFixture('php', path.join(fixture, 'readers', 'php')).units.find((u) => u.name === 'Derived')?.kind;
  assert.equal(kind, 'class', `Derived is a ${kind} unit`);
});

test('a Node module of functions is internal only when each of its exported functions carries @internal', () => {
  const units = readFixture('node', path.join(fixture, 'readers', 'node')).units;
  assert.equal(units.find((u) => u.name === 'hidden')?.internal, true, 'hidden is not internal');
  assert.equal(units.find((u) => u.name === 'shown')?.internal, false, 'shown is internal');
});

test('the Node reader reads a test called on any receiver, and an each table written as a tagged template', () => {
  const out = readFixture('node', path.join(fixture, 'readers', 'node'));
  const names = out.tests.map((t) => t.name);
  assert.ok(names.includes('suite > via receiver'), `tests: ${names.join(', ')}`);
  assert.ok(names.includes('suite > skipped'), `tests: ${names.join(', ')}`);
  assert.deepEqual(out.dynamicTests.map((t) => t.line), [3], `dynamic lines: ${out.dynamicTests.map((t) => t.line).join(', ')}`);
});

test('the Node reader lists an accessor as a method, with its head and not its body', () => {
  const members = readFixture('node', path.join(fixture, 'readers', 'node')).members.filter((m) => m.unit === 'Accessed');
  const size = members.find((m) => m.name === 'size');
  const kind = members.find((m) => m.name === 'kind');
  assert.equal(size?.kind, 'method', `size is ${size?.kind}`);
  assert.equal(size?.signature, 'get size(): number', `size signature: ${size?.signature}`);
  assert.equal(kind?.kind, 'static method', `kind is ${kind?.kind}`);
  assert.equal(kind?.signature, 'static get kind(): string', `kind signature: ${kind?.signature}`);
});

test('the readers read only the files that git tracks under their source and test directories', () => {
  const extra = {
    php: ['src/Untracked.php', '<?php\nclass Untracked {}\n'],
    node: ['src/untracked.ts', 'export class Untracked {}\n'],
    python: ['src/untracked.py', 'class Untracked:\n    pass\n'],
  } as const;
  for (const lang of ['php', 'node', 'python'] as const) {
    const root = mkdtempSync(path.join(tmpdir(), 'recipe-tracked-'));
    try {
      cpSync(path.join(fixture, 'readers', lang), root, { recursive: true });
      track(root);
      const [file, code] = extra[lang];
      writeFileSync(path.join(root, file), code);
      const out = readFixture(lang, root);
      assert.ok(!out.units.some((u) => u.name === 'Untracked'), `${lang} read the untracked file ${file}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// The scopes and the registries of the readers (HYR-5, HYR-7), read from a tracked copy of a tree.

/** Runs the reader of a language over a tracked copy of `dir` with the arguments, and returns its output. */
function readCopy(lang: Lang, dir: string, args: string[]): Sources {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-scopes-'));
  try {
    cpSync(dir, root, { recursive: true });
    track(root);
    const [bin, prefix] = readerCommands[lang](root);
    const autoload = lang === 'php' ? ['--autoload', path.join(root, args.includes('src') ? 'autoload.php' : 'vendor/autoload.php')] : [];
    return runReader(lang, bin, [...prefix.slice(0, 2), ...autoload, ...args]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const READER_FILES: Record<Lang, { receivers: string; widget: string }> = {
  php: { receivers: 'src/Receivers.php', widget: 'src/Widget.php' },
  node: { receivers: 'src/receivers.ts', widget: 'src/widget.ts' },
  python: { receivers: 'src/receivers.py', widget: 'src/widget.py' },
};

test('each reader writes the receiver of a name: an object, a class, the own class, a construction, a conditional and a loop', () => {
  for (const lang of ['php', 'node', 'python'] as const) {
    const out = readCopy(lang, path.join(fixture, 'readers', lang), ['--sources', 'src', '--tests', 'tests']);
    const widget: ClassRef = { file: READER_FILES[lang].widget, name: 'Widget' };
    const scope = out.scopes.find((s) => s.file === READER_FILES[lang].receivers && s.name === 'Receivers.run');
    assert.ok(scope !== undefined, `${lang} has no scope Receivers.run: ${out.scopes.map((s) => s.name).join(', ')}`);
    const has = (e: Expr): boolean => scope.uses.some((u) => JSON.stringify(u) === JSON.stringify(e));
    const variable = (name: string): Expr => ({ kind: 'variable', name });
    for (const e of [
      { kind: 'member', of: variable('widget'), name: 'grow', call: true },
      { kind: 'member', of: { kind: 'class', ...widget }, name: 'make', call: true },
      { kind: 'member', of: { kind: 'own' }, name: 'other', call: true },
      { kind: 'new', class: widget },
      { kind: 'member', of: variable('item'), name: 'size', call: false },
    ] satisfies Expr[]) {
      assert.ok(has(e), `${lang} lacks the use ${JSON.stringify(e)}: ${JSON.stringify(scope.uses)}`);
    }
    // The parameter whose type names no class of the tree has none, and a write of a property is no use of it.
    assert.deepEqual(scope.parameters.map((p) => [p.name, p.type?.name ?? null]), [['widget', 'Widget'], [lang === 'python' ? 'text' : 'items', null]], lang);
    assert.ok(!scope.uses.some((u) => u.kind === 'member' && u.name === 'kept'), `${lang} took the write of kept for a use`);
    const assigned = (target: string | { own: string }): Expr | undefined => scope.assigns.find((a) => JSON.stringify(a.target) === JSON.stringify(target))?.value;
    assert.deepEqual(assigned({ own: 'kept' }), variable('made'), lang);
    assert.deepEqual(assigned('either'), { kind: 'either', of: [variable('widget'), { kind: 'new', class: widget }] }, lang);
    assert.deepEqual(scope.loops, [{ variable: 'item', over: { kind: 'member', of: { kind: 'own' }, name: 'all', call: true } }], lang);
    const receivers: SourceClass | undefined = out.classes.find((c) => c.name === 'Receivers');
    assert.deepEqual(receivers?.properties.find((p) => p.name === 'kept')?.type, widget, `${lang} property kept`);
  }
});

const RECIPE_TREES: Record<Lang, string[]> = {
  php: ['--sources', 'packages/server/php/src', '--tests', 'packages/server/php/tests', '--registry', 'packages/server/php/tests/CaseSteps.php'],
  node: ['--sources', 'packages/server/ts/src', '--tests', 'packages/server/ts/tests', '--registry', 'packages/server/ts/tests/case-runner.test.mts'],
  python: ['--sources', 'packages/server/python/src/polyspec/hyper', '--tests', 'packages/server/python/tests', '--registry', 'packages/server/python/tests/steps/__init__.py'],
};
const STEP_FILES: Record<Lang, [string, string, string]> = {
  php: ['packages/server/php/tests/Steps/CsrfSteps.php', 'packages/server/php/tests/Steps/MediaTypeSteps.php', 'packages/server/php/tests/Steps/EssenceReader.php'],
  node: ['packages/server/ts/tests/steps/csrf.ts', 'packages/server/ts/tests/steps/media-type.ts', 'packages/server/ts/tests/steps/essence-reader.ts'],
  python: ['packages/server/python/tests/steps/csrf_steps.py', 'packages/server/python/tests/steps/media_type_steps.py', 'packages/server/python/tests/steps/essence_reader.py'],
};
const STEP_NAMES: Record<Lang, [string, string]> = { php: ['CsrfSteps.mask', 'MediaTypeSteps.essence'], node: ['steps.mask', 'steps.essence'], python: ['mask', 'essence'] };

test('each reader emits the entries of its registry and the scopes of every file of the test tree, a file without a test included', () => {
  for (const lang of ['php', 'node', 'python'] as const) {
    const out = readCopy(lang, fixture, RECIPE_TREES[lang]);
    const [csrf, media, reader] = STEP_FILES[lang];
    const [mask, essence] = STEP_NAMES[lang];
    assert.deepEqual(out.registry, [
      { file: 'csrf.json', section: 'mask', step: { file: csrf, name: mask } },
      { file: 'media-type.json', section: 'essence', step: { file: media, name: essence } },
    ], lang);
    // The class that the step of media-type.json constructs holds no test, and its method is a scope.
    assert.ok(out.scopes.some((s) => s.file === reader && s.name === 'EssenceReader.read'), `${lang} has no scope EssenceReader.read`);
    assert.ok(!out.tests.some((t) => t.file === reader), `${lang} took a method of ${reader} for a test`);
  }
});

test('a passing run prints the three numbers of the fixture: the members stated directly and the internal and private members stated through their callers', () => {
  withFixtureCopy('recipe-counts-', (root) => {
    const { status, output } = checkOf(root);
    assert.equal(status, 0, output);
    // Directly: csrf.constructor, the internal csrf.mask that a section names, media-type.parse and media-type.essence.
    // Internal: csrf.raw, json-codec.decode, csrf.check (which php and python have and which a member of one language
    // reaches in each), and token.constructor, token.text, token.shape, signed-token.constructor, signed-token.all and
    // signed-token.shape. Private: csrf.fold, media-type.folded, media-type.constructor, token.seed and signed-token.sign.
    assert.match(output, /4 members stated directly, 9 internal and 5 private members stated through their callers/u);
  });
});

// The reading of HYR-5 over scopes written by hand: two languages with the same classes, so that a finding is the
// reading and not a difference between the languages.

type Kind = 'constructor' | 'method' | 'static method';
type Written = { unit: string; extends?: string; properties?: [string, string][]; members: { name: string; kind: Kind; visibility: Member['visibility']; output?: string }[] };
const FILE: Record<'php' | 'node', (unit: string) => string> = { php: (u) => `src/${u.charAt(0).toUpperCase()}${u.slice(1)}.php`, node: (u) => `src/${u}.ts` };
const NATIVE: Record<'php' | 'node', (unit: string, name: string) => string> = {
  php: (u, n) => `${FILE.php(u)}::Fx\\${u.charAt(0).toUpperCase()}${u.slice(1)}::${n === 'constructor' ? '__construct' : n}`,
  node: (u, n) => `${FILE.node(u)}::${u.charAt(0).toUpperCase()}${u.slice(1)}.${n}`,
};
const cls = (unit: string): string => `${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;

/**
 * The findings and the numbers of the stated check for written units, a section that names `named`, and the scopes
 * that `scopes` writes for a language: each scope by its unit and method, with expressions built for that language.
 */
function stated(
  units: Written[],
  named: string[],
  scopes: (lang: 'php' | 'node', e: { cls: (unit: string) => Expr; ref: (unit: string) => ClassRef }) => { unit: string; method: string; uses?: Expr[]; assigns?: Scope['assigns']; loops?: Scope['loops']; returns?: ClassRef; parameters?: Parameter[] }[],
): { findings: string[] } {
  const specUnits: Unit[] = units.map((w) => ({
    id: w.unit,
    native: { php: { file: FILE.php(w.unit), kind: 'class', internal: true }, node: { file: FILE.node(w.unit), kind: 'class', internal: true } },
    members: w.members.map((m) => ({
      id: `${w.unit}.${m.name}`,
      kind: m.kind,
      visibility: m.visibility,
      inputs: [],
      output: m.output ?? 'string',
      errors: [],
      state: 'A member.',
      native: { php: { symbol: NATIVE.php(w.unit, m.name), signature: '' }, node: { symbol: NATIVE.node(w.unit, m.name), signature: '' } },
    })),
  }));
  const spec: Spec = {
    schema: 1,
    languages: { php: { sources: ['src'], tests: ['tests'], barrel: [] }, node: { sources: ['src'], tests: ['tests'], barrel: [] }, python: { sources: ['src'], tests: ['tests'], barrel: [] } },
    runners: {
      php: { runner: 'tests/R.php::R::run', steps: 'tests/steps', registry: 'tests/R.php' },
      node: { runner: 'tests/r.ts::run', steps: 'tests/steps', registry: 'tests/r.ts' },
      python: { runner: 'tests/r.py::R.run', steps: 'tests/steps', registry: 'tests/r.py' },
      browser: { runner: 'tests/b.ts::run' },
      build: { runner: 'tests/c.ts::run' },
    },
    caseReaders: { php: 'tests/Reader.php::Reader', node: 'tests/reader.ts::Reader', python: 'tests/reader.py::Reader' },
    outside: [],
    groups: ['all'],
    concerns: [{ id: 'all', rules: [], cases: ['contracts/all.json'], group: 'all', units: specUnits }],
    types: [],
    caseFiles: { 'all.json': { fixtures: {}, sections: { all: { runners: ['php', 'node'], uses: [], members: named, fields: {} } } } },
  };
  const sourcesOf = (lang: 'php' | 'node'): Sources => {
    const ref = (unit: string): ClassRef => ({ file: FILE[lang](unit), name: cls(unit) });
    const classes: SourceClass[] = units.map((w) => ({
      ...ref(w.unit),
      extends: w.extends === undefined ? [] : [ref(w.extends)],
      properties: (w.properties ?? []).map(([name, unit]) => ({ name, type: ref(unit) })),
    }));
    const written = scopes(lang, { cls: (unit) => ({ kind: 'class', ...ref(unit) }), ref });
    const all: Scope[] = written.map((s) => ({
      file: FILE[lang](s.unit),
      name: `${cls(s.unit)}.${s.method === 'constructor' && lang === 'php' ? '__construct' : s.method}`,
      class: cls(s.unit),
      parameters: s.parameters ?? [],
      uses: s.uses ?? [],
      assigns: s.assigns ?? [],
      loops: s.loops ?? [],
      ...(s.returns === undefined ? {} : { returns: s.returns }),
    }));
    return { ...emptySources(lang), classes, scopes: all };
  };
  const empty: Sources = emptySources('python');
  const findings: string[] = [];
  checkStated({
    spec,
    root: '',
    protocol: { rules: new Map(), retiredRules: new Set(), terms: new Set(), statuses: '' },
    sources: { php: sourcesOf('php'), node: sourcesOf('node'), python: empty },
    readDir: () => empty,
    add: (code, message) => findings.push(`${code} ${message}`),
  });
  return { findings: findings.filter((f) => f.startsWith('MEMBER_')) };
}

const BOX: Written[] = [
  { unit: 'box', members: [{ name: 'run', kind: 'method', visibility: 'public' }, { name: 'all', kind: 'static method', visibility: 'public', output: 'list<item>' }] },
  { unit: 'item', members: [{ name: 'size', kind: 'method', visibility: 'internal' }] },
];

test('the variable of a loop over the list that a member returns has the class inside the list, and an output that names no unit gives none', () => {
  const loop = (lang: 'php' | 'node', e: { cls: (unit: string) => Expr }): ReturnType<Parameters<typeof stated>[2]> => [
    { unit: 'box', method: 'run', uses: [{ kind: 'member', of: { kind: 'variable', name: 'it' }, name: 'size', call: true }], loops: [{ variable: 'it', over: { kind: 'member', of: e.cls('box'), name: 'all', call: true } }] },
    { unit: 'box', method: 'all' },
  ];
  assert.deepEqual(stated(BOX, ['box.run', 'box.all'], loop).findings, []);
  const strings = BOX.map((w) => ({ ...w, members: w.members.map((m) => (m.name === 'all' ? { ...m, output: 'list<string>' } : m)) }));
  assert.deepEqual(stated(strings, ['box.run', 'box.all'], loop).findings, [
    'MEMBER_UNREACHED internal member item.size is named by no section and reached by no stated member in php',
    'MEMBER_UNREACHED internal member item.size is named by no section and reached by no stated member in node',
  ]);
});

test('a conditional of two constructions of one class has the class, and of two classes has none', () => {
  const run = (other: string) => (_lang: 'php' | 'node', e: { ref: (unit: string) => ClassRef }): ReturnType<Parameters<typeof stated>[2]> => [
    {
      unit: 'box',
      method: 'run',
      assigns: [{ target: 'x', value: { kind: 'either', of: [{ kind: 'new', class: e.ref('item') }, { kind: 'new', class: e.ref(other) }] } }],
      uses: [{ kind: 'member', of: { kind: 'variable', name: 'x' }, name: 'size', call: true }],
    },
  ];
  assert.deepEqual(stated(BOX, ['box.run', 'box.all'], run('item')).findings, []);
  assert.equal(stated(BOX, ['box.run', 'box.all'], run('box')).findings.length, 2);
});

test('a write of a property and a name after a receiver without a class are no calls', () => {
  const run = (): ReturnType<Parameters<typeof stated>[2]> => [
    {
      unit: 'box',
      method: 'run',
      assigns: [{ target: { own: 'size' }, value: { kind: 'other' } }],
      uses: [{ kind: 'member', of: { kind: 'other' }, name: 'size', call: true }, { kind: 'member', of: { kind: 'variable', name: 'text' }, name: 'size', call: true }],
    },
  ];
  assert.equal(stated(BOX, ['box.run', 'box.all'], run).findings.length, 2);
});

test('a call on a class reaches the member of the nearest class that it extends and the members of the classes that extend it', () => {
  const units: Written[] = [
    { unit: 'box', members: [{ name: 'run', kind: 'method', visibility: 'public' }] },
    { unit: 'item', members: [{ name: 'constructor', kind: 'constructor', visibility: 'private' }, { name: 'size', kind: 'method', visibility: 'internal' }] },
    { unit: 'sub', extends: 'item', members: [{ name: 'size', kind: 'method', visibility: 'internal' }] },
  ];
  // `new Sub` runs the constructor of Item, which Sub does not declare; a call of size on an Item reaches the size of Sub.
  const run = (_lang: 'php' | 'node', e: { ref: (unit: string) => ClassRef }): ReturnType<Parameters<typeof stated>[2]> => [
    { unit: 'box', method: 'run', uses: [{ kind: 'new', class: e.ref('sub') }, { kind: 'member', of: { kind: 'new', class: e.ref('item') }, name: 'size', call: true }] },
    { unit: 'item', method: 'constructor' },
    { unit: 'item', method: 'size' },
    { unit: 'sub', method: 'size' },
  ];
  assert.deepEqual(stated(units, ['box.run'], run).findings, []);
});

test('a read of a property whose type is written has that class, also when a class that it extends declares it', () => {
  const units: Written[] = [
    { unit: 'base', properties: [['held', 'item']], members: [] },
    { unit: 'box', extends: 'base', properties: [['item', 'item']], members: [{ name: 'run', kind: 'method', visibility: 'public' }] },
    { unit: 'item', members: [{ name: 'size', kind: 'method', visibility: 'internal' }, { name: 'grow', kind: 'method', visibility: 'internal' }] },
  ];
  const run = (): ReturnType<Parameters<typeof stated>[2]> => [
    {
      unit: 'box',
      method: 'run',
      uses: [
        { kind: 'member', of: { kind: 'member', of: { kind: 'own' }, name: 'item', call: false }, name: 'size', call: true },
        { kind: 'member', of: { kind: 'member', of: { kind: 'own' }, name: 'held', call: false }, name: 'grow', call: true },
      ],
    },
  ];
  assert.deepEqual(stated(units, ['box.run'], run).findings, []);
});

test('the PHP reader reads a value after a string with an embedded expression, and a match as a conditional of its arms', () => {
  const out = readCopy('php', path.join(fixture, 'readers', 'php'), ['--sources', 'src', '--tests', 'tests']);
  const scope = out.scopes.find((s) => s.name === 'Receivers.run');
  const widget: ClassRef = { file: 'src/Widget.php', name: 'Widget' };
  const made: Expr = { kind: 'member', of: { kind: 'class', ...widget }, name: 'make', call: true };
  const assigned = (target: string): Expr | undefined => scope?.assigns.find((a) => a.target === target)?.value;
  assert.deepEqual(assigned('opened'), made);
  assert.deepEqual(assigned('matched'), { kind: 'either', of: [{ kind: 'new', class: widget }, made] });
});

test('each reader writes the return type of a function when it names one class', () => {
  for (const lang of ['php', 'node', 'python'] as const) {
    const out = readCopy(lang, path.join(fixture, 'readers', lang), ['--sources', 'src', '--tests', 'tests']);
    const scope = (name: string): Scope | undefined => out.scopes.find((s) => s.file === READER_FILES[lang].receivers && s.name === name);
    assert.deepEqual(scope('Receivers.made')?.returns, { file: READER_FILES[lang].widget, name: 'Widget' }, lang);
    assert.equal(scope('Receivers.run')?.returns, undefined, lang);
  }
});

test('a call of a function that no member of the spec is has the class of its written return type', () => {
  const units: Written[] = [
    { unit: 'box', members: [{ name: 'run', kind: 'method', visibility: 'public' }] },
    { unit: 'item', members: [{ name: 'size', kind: 'method', visibility: 'internal' }] },
  ];
  const run = (_lang: 'php' | 'node', e: { ref: (unit: string) => ClassRef }): ReturnType<Parameters<typeof stated>[2]> => [
    { unit: 'box', method: 'run', uses: [{ kind: 'member', of: { kind: 'member', of: { kind: 'own' }, name: 'helper', call: true }, name: 'size', call: true }] },
    { unit: 'box', method: 'helper', returns: e.ref('item') },
  ];
  assert.deepEqual(stated(units, ['box.run'], run).findings, []);
});

test('the Node reader reads an interface as a class that a class implements, with its typed properties, and a parameter of its type', () => {
  const out = readCopy('node', path.join(fixture, 'readers', 'node'), ['--sources', 'src', '--tests', 'tests']);
  const sized: ClassRef = { file: 'src/sized.ts', name: 'Sized' };
  assert.deepEqual(out.classes.find((c) => c.name === 'Sized'), { ...sized, extends: [], properties: [{ name: 'next', type: sized }, { name: 'count' }] });
  assert.deepEqual(out.classes.find((c) => c.name === 'Widget')?.extends, [sized]);
  assert.deepEqual(out.scopes.find((s) => s.name === 'Receivers.sized')?.parameters, [{ name: 'item', type: sized }]);
});

test('each reader writes the class inside a written list type of a parameter, PHP in the doc comment', () => {
  for (const lang of ['php', 'node', 'python'] as const) {
    const out = readCopy(lang, path.join(fixture, 'readers', lang), ['--sources', 'src', '--tests', 'tests']);
    const widget: ClassRef = { file: READER_FILES[lang].widget, name: 'Widget' };
    const scope = out.scopes.find((s) => s.file === READER_FILES[lang].receivers && s.name === 'Receivers.listed');
    assert.deepEqual(scope?.parameters, [{ name: 'widgets', items: widget }, { name: 'others', items: widget }], lang);
  }
});

test('the variable of a loop over a parameter whose written type is a list of a class has that class', () => {
  const run = (_lang: 'php' | 'node', e: { ref: (unit: string) => ClassRef }): ReturnType<Parameters<typeof stated>[2]> => [
    {
      unit: 'box',
      method: 'run',
      parameters: [{ name: 'items', items: e.ref('item') }],
      loops: [{ variable: 'it', over: { kind: 'variable', name: 'items' } }],
      uses: [{ kind: 'member', of: { kind: 'variable', name: 'it' }, name: 'size', call: true }],
    },
  ];
  assert.deepEqual(stated(BOX, ['box.run', 'box.all'], run).findings, []);
});

test('the PHP reader reads a method whose name is a keyword, and a call of it', () => {
  const out = readCopy('php', path.join(fixture, 'readers', 'php'), ['--sources', 'src', '--tests', 'tests']);
  const scope = out.scopes.find((s) => s.name === 'Receivers.match');
  assert.deepEqual(scope?.uses, [{ kind: 'member', of: { kind: 'own' }, name: 'xor', call: true }]);
  assert.ok(out.scopes.some((s) => s.name === 'Receivers.xor'), 'no scope Receivers.xor');
});

test('the Node reader reads a name that an object pattern binds as a read of the property of that name', () => {
  const out = readCopy('node', path.join(fixture, 'readers', 'node'), ['--sources', 'src', '--tests', 'tests']);
  const scope = out.scopes.find((s) => s.name === 'Receivers.sized');
  assert.deepEqual(scope?.assigns, [
    { target: 'kept', value: { kind: 'member', of: { kind: 'own' }, name: 'kept', call: false } },
    { target: 'following', value: { kind: 'member', of: { kind: 'variable', name: 'item' }, name: 'next', call: false } },
  ]);
});

test('the Python reader reads a generic base class with its arguments as the class that a class extends', () => {
  const out = readCopy('python', path.join(fixture, 'readers', 'python'), ['--sources', 'src', '--tests', 'tests']);
  assert.deepEqual(out.classes.find((c) => c.name === 'Widgets')?.extends, [{ file: 'src/receivers.py', name: 'Listed' }]);
});

test('a PHP read of a property reaches no method of that name, because PHP keeps properties and methods apart', () => {
  const units: Written[] = [
    {
      unit: 'box',
      members: [
        { name: 'run', kind: 'method', visibility: 'public' },
        { name: 'query', kind: 'method', visibility: 'internal' },
      ],
    },
  ];
  const run = (): ReturnType<Parameters<typeof stated>[2]> => [
    { unit: 'box', method: 'run', uses: [{ kind: 'member', of: { kind: 'own' }, name: 'query', call: false }] },
    { unit: 'box', method: 'query' },
  ];
  assert.deepEqual(
    stated(units, ['box.run'], run).findings.filter((f) => f.includes('box.query')),
    ['MEMBER_UNREACHED internal member box.query is named by no section and reached by no stated member in php'],
  );
});

test('the Node reader writes the call of the parent constructor in the constructor that a class without one has', () => {
  const out = readCopy('node', path.join(fixture, 'readers', 'node'), ['--sources', 'src', '--tests', 'tests']);
  const scope = out.scopes.find((s) => s.name === 'Bigger.constructor');
  assert.deepEqual(scope?.uses, [{ kind: 'member', of: { kind: 'parent' }, name: 'constructor', call: true }]);
});

test('the PSR-4 list of each composer.json is the directory of each group that holds a PHP unit (HYR-4)', () => {
  const spec = specOf(path.join(repo, 'contracts', 'interfaces.json'));
  const groups = spec.groups.filter((g) => spec.concerns.some((c) => c.group === g && c.units.some((u) => u.native.php !== undefined)));
  const directories = groups.map((g) => `src/${expectedDirectory('php', g)}/`).sort();
  assert.ok(directories.length > 0, 'no group of the spec holds a PHP unit');
  const psr4 = (file: string): unknown => at(readJson(path.join(repo, file)), 'autoload', 'psr-4', 'Polyspec\\Hyper\\');
  assert.deepEqual(psr4('packages/server/php/composer.json'), directories);
  assert.deepEqual(psr4('composer.json'), directories.map((d) => `packages/server/php/${d}`));
});
