// The recipe check (HYR-8) over the fixture tree of fixtures/recipe: the fixture passes with its mutation cases, and each
// mutation of fixtures/recipe/mutations.json fails the check with the finding code that the mutation names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validators } from '../../scripts/recipe/validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');
const candidate = path.join(repo, 'scripts', 'recipe', 'candidate.mts');
/** The PHP autoloader of a recipe tree: the fixture's stand-in for the server's Composer autoloader. */
const phpAutoload = (root: string): string => path.join(root, 'vendor', 'autoload.php');

type Mutation = { id: string; file: string; code: string; from?: string; to?: string; rename?: string; create?: string; delete?: boolean; forbid?: string; detail?: string };

test('the schema term is the vocabulary: a status number is not a term', () => {
  const text = readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8');
  const spec = validators().spec;
  assert.equal(spec(JSON.parse(text)), true);
  assert.equal(spec(JSON.parse(text.replace('"output": "string",', '"output": "404",'))), false);
});

const mutations = JSON.parse(readFileSync(path.join(fixture, 'mutations.json'), 'utf8')) as Mutation[];

function resultArguments(root: string): string[] {
  return ['php', 'node', 'python', 'browser', 'build'].flatMap((lang) => ['--results', `${lang}=${path.join(root, 'results', `${lang}.txt`)}`]);
}

/** Makes a copied tree a git repository whose files are all tracked: the readers list the files git tracks. */
function track(root: string): void {
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
}

function applyMutation(root: string, m: Mutation): void {
  const file = path.join(root, m.file);
  if (m.delete) {
    unlinkSync(file);
    return;
  }
  if (m.create !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, m.create);
    return;
  }
  if (m.rename !== undefined) {
    const text = readFileSync(file, 'utf8');
    unlinkSync(file);
    writeFileSync(path.join(root, m.rename), text);
    return;
  }
  const text = readFileSync(file, 'utf8');
  const from = m.from ?? '';
  assert.ok(text.includes(from), `mutation ${m.id}: ${JSON.stringify(from)} is not in ${m.file}`);
  writeFileSync(file, text.replace(from, m.to ?? ''));
}

test('the fixture passes the recipe check, with its mutation cases first', () => {
  const result = spawnSync(process.execPath, [check, '--root', fixture, '--php-autoload', phpAutoload(fixture), ...resultArguments(fixture)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a sentence may cite a statement of an HYC rule of protocol.json', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-hyc-'));
  try {
    cpSync(fixture, root, { recursive: true });
    applyMutation(root, { id: 'hyc-sentence', file: 'contracts/interfaces.json', from: '"sentence": "HY-1.1",', to: '"sentence": "HYC-1.1",', code: 'SENTENCE_UNKNOWN' });
    track(root);
    const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /\bSENTENCE_UNKNOWN\b/);
    assert.equal(result.status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a constructor of each case reader is one member, whatever the language calls it and whatever its visibility', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-ctor-'));
  const replaceIn = (file: string, from: string, to: string): void => {
    const target = path.join(root, file);
    const text = readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `${file} lacks ${JSON.stringify(from)}`);
    writeFileSync(target, text.replace(from, to));
  };
  try {
    cpSync(fixture, root, { recursive: true });
    replaceIn('packages/server/php/tests/CaseReader.php', '    public function cases(): array', '    private function __construct()\n    {\n    }\n\n    public function cases(): array');
    replaceIn('packages/server/python/tests/case_reader.py', '    def cases(self):', '    def __init__(self):\n        pass\n\n    def cases(self):');
    replaceIn('packages/server/ts/tests/case-reader.ts', '  cases(): unknown[] {', '  constructor() {}\n\n  cases(): unknown[] {');
    track(root);
    const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /\bCASE_READER_MEMBERS\b/);
    assert.equal(result.status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an internal member of a public Python module is named with a leading underscore', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-internal-'));
  const replaceIn = (file: string, from: string, to: string): void => {
    const target = path.join(root, file);
    const text = readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `${file} lacks ${JSON.stringify(from)}`);
    writeFileSync(target, text.replace(from, to));
  };
  try {
    cpSync(fixture, root, { recursive: true });
    replaceIn('packages/server/php/src/MediaType.php', "        return 'text/html';\n    }\n", "        return 'text/html';\n    }\n\n    /** @internal */\n    public function label(): string\n    {\n        return 'html';\n    }\n");
    replaceIn('packages/server/ts/src/media-type.ts', "    return 'text/html';\n  }\n", "    return 'text/html';\n  }\n\n  /** @internal */\n  label(): string {\n    return 'html';\n  }\n");
    replaceIn('packages/server/python/src/polyspec/hyper/media_type.py', '        return "text/html"\n', '        return "text/html"\n\n    def _label(self) -> str:\n        return "html"\n');
    const specFile = path.join(root, 'contracts', 'interfaces.json');
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { concerns: { units: { id: string; members: unknown[] }[] }[] };
    const unit = spec.concerns.flatMap((c) => c.units).find((u) => u.id === 'media-type');
    assert.ok(unit, 'the fixture has no unit media-type');
    unit.members.push({
      id: 'media-type.label',
      kind: 'method',
      visibility: 'internal',
      inputs: [],
      output: 'string',
      errors: [],
      state: 'Returns the label.',
      native: {
        php: { symbol: 'packages/server/php/src/MediaType.php::Polyspec\\Hyper\\MediaType::label', signature: 'public function label(): string' },
        node: { symbol: 'packages/server/ts/src/media-type.ts::MediaType.label', signature: 'label(): string' },
        python: { symbol: 'packages/server/python/src/polyspec/hyper/media_type.py::MediaType._label', signature: 'def _label(self) -> str' },
      },
    });
    writeFileSync(specFile, JSON.stringify(spec, null, 2));
    track(root);
    const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /\bMEMBER_NAME\b/);
    assert.equal(result.status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a Python parameter named cls or self after the receiver is an input', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-receiver-'));
  const replaceIn = (file: string, from: string, to: string): void => {
    const target = path.join(root, file);
    const text = readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `${file} lacks ${JSON.stringify(from)}`);
    writeFileSync(target, text.replace(from, to));
  };
  try {
    cpSync(fixture, root, { recursive: true });
    replaceIn('packages/server/php/src/MediaType.php', "        return 'text/html';\n    }\n", "        return 'text/html';\n    }\n\n    public function named(string $cls): string\n    {\n        return $cls;\n    }\n");
    replaceIn('packages/server/ts/src/media-type.ts', "    return 'text/html';\n  }\n", "    return 'text/html';\n  }\n\n  named(cls: string): string {\n    return cls;\n  }\n");
    replaceIn('packages/server/python/src/polyspec/hyper/media_type.py', '        return "text/html"\n', '        return "text/html"\n\n    def named(self, cls: str) -> str:\n        return cls\n');
    const specFile = path.join(root, 'contracts', 'interfaces.json');
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { concerns: { units: { id: string; members: unknown[] }[] }[] };
    const unit = spec.concerns.flatMap((c) => c.units).find((u) => u.id === 'media-type');
    assert.ok(unit, 'the fixture has no unit media-type');
    unit.members.push({
      id: 'media-type.named',
      kind: 'method',
      visibility: 'public',
      inputs: ['string'],
      output: 'string',
      errors: [],
      state: 'Returns the name.',
      native: {
        php: { symbol: 'packages/server/php/src/MediaType.php::Polyspec\\Hyper\\MediaType::named', signature: 'public function named(string $cls): string' },
        node: { symbol: 'packages/server/ts/src/media-type.ts::MediaType.named', signature: 'named(cls: string): string' },
        python: { symbol: 'packages/server/python/src/polyspec/hyper/media_type.py::MediaType.named', signature: 'def named(self, cls: str) -> str' },
      },
    });
    writeFileSync(specFile, JSON.stringify(spec, null, 2));
    track(root);
    const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /\bMEMBER_SIGNATURE\b/);
    assert.equal(result.status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the candidate refreshes the native fields and lists the hand-written ones', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-candidate-'));
  try {
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', fixture, '--php-autoload', phpAutoload(fixture), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const spec = JSON.parse(readFileSync(output, 'utf8')) as { schema: number };
    assert.equal(spec.schema, 1);
    const handWritten = JSON.parse(readFileSync(path.join(dir, 'interfaces.candidate.hand-written.json'), 'utf8')) as string[];
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
    const spec = JSON.parse(readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(path.join(root, 'contracts', 'interfaces.json'), JSON.stringify({ ...spec, outside: [], concerns: [], types: [] }));
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', root, '--php-autoload', phpAutoload(root), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const derived = JSON.parse(readFileSync(output, 'utf8')) as { concerns: { id: string; units: { native: Record<string, unknown> }[] }[] };
    const csrf = derived.concerns.find((c) => c.id === 'csrf');
    assert.ok(csrf, 'no concern csrf');
    assert.deepEqual(Object.keys(csrf?.units[0]?.native ?? {}).sort(), ['node', 'php', 'python']);
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
    const spec = JSON.parse(readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8')) as { concerns: { id: string; units: { members: unknown[] }[] }[] };
    const csrf = spec.concerns.find((c) => c.id === 'csrf');
    assert.ok(csrf?.units[0] !== undefined, 'the fixture has no unit of csrf');
    const expected = csrf.units[0].members.length;
    csrf.units[0].members = [];
    writeFileSync(path.join(root, 'contracts', 'interfaces.json'), JSON.stringify(spec));
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', root, '--php-autoload', phpAutoload(root), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const derived = JSON.parse(readFileSync(output, 'utf8')) as { concerns: { id: string; units: { members: { native: Record<string, unknown> }[] }[] }[] };
    const members = derived.concerns.find((c) => c.id === 'csrf')?.units[0]?.members ?? [];
    assert.ok(expected > 0, 'the fixture unit of csrf has no members');
    assert.equal(members.length, expected);
    assert.ok(members.every((m) => Object.keys(m.native).length > 0), 'a derived member names no native symbol');
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
      track(root);
      const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `mutation ${m.id} passed the check`);
      const output = result.stdout + result.stderr;
      assert.match(output, new RegExp(`\\b${m.code}\\b`));
      if (m.forbid !== undefined) assert.doesNotMatch(output, new RegExp(`\\b${m.forbid}\\b`));
      if (m.detail !== undefined) assert.ok(output.includes(m.detail), `mutation ${m.id}: output lacks ${m.detail}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// The readers' own output for a tree, as the check reads it (HYR-8).
type ReaderOutput = { units: { name: string; kind: string; internal: boolean }[]; uses: { file: string; name: string }[]; constants: { file: string; name: string }[]; tests: { file: string; name: string }[]; dynamicTests: { file: string; line: number }[]; members: { unit: string; name: string; kind: string; visibility: string; signature: string; parameters: string[] }[] };

const readerCommands: Record<'php' | 'node' | 'python', (root: string) => [string, string[]]> = {
  php: (root) => [process.env.RECIPE_PHP ?? 'php', [path.join(repo, 'scripts', 'recipe', 'read-php.php'), root, '--autoload', path.join(root, 'autoload.php')]],
  node: (root) => [process.execPath, [path.join(repo, 'scripts', 'recipe', 'read-node.mts'), root]],
  python: (root) => [process.env.RECIPE_PYTHON ?? 'python3', [path.join(repo, 'scripts', 'recipe', 'read_python.py'), root]],
};
function readFixture(lang: 'php' | 'node' | 'python', root: string): ReaderOutput {
  const [bin, prefix] = readerCommands[lang](root);
  const result = spawnSync(bin, [...prefix, '--sources', 'src', '--tests', 'tests'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as ReaderOutput;
}
const readPython = (root: string): ReaderOutput => readFixture('python', root);

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
