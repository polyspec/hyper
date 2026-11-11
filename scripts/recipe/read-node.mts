// Reads the Node server sources for the recipe check (HYR-8) with the TypeScript compiler API and prints one JSON
// document on stdout. Usage: node read-node.mts <root> --sources <dir>... [--tests <dir>...]
// The compiler comes from the private package scripts/recipe/typescript (TypeScript 6.0.3, see its description).

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const require = createRequire(new URL('./typescript/package.json', import.meta.url));
const ts = require('typescript') as typeof import('typescript');

const [root, ...rest] = process.argv.slice(2);
if (root === undefined) {
  console.error('usage: read-node.mts <root> --sources <dir>... [--tests <dir>...]');
  process.exit(2);
}
const groups: Record<'sources' | 'tests', string[]> = { sources: [], tests: [] };
let current: 'sources' | 'tests' | undefined;
for (const arg of rest) {
  if (arg === '--sources' || arg === '--tests') {
    current = arg.slice(2) as 'sources' | 'tests';
    continue;
  }
  if (current === undefined) {
    throw new Error(`argument before --sources or --tests: ${arg}`);
  }
  groups[current].push(arg);
}

function listFiles(dirs: string[], keep: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(join(root!, dir), { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && keep(entry.name)) {
        found.push(relative(root!, join(entry.parentPath, entry.name)).split(sep).join('/'));
      }
    }
  }
  return [...new Set(found)].sort();
}

type Visibility = 'public' | 'internal' | 'private' | 'protected';
type Out = {
  language: 'node';
  files: string[];
  units: { file: string; name: string; kind: string; internal: boolean }[];
  types: { file: string; name: string; visibility: Visibility; declaration: string; fields?: string[]; parameters?: number }[];
  members: { file: string; unit: string; name: string; kind: string; visibility: Visibility; symbol: string; signature: string; parameters: string[] }[];
  constants: { file: string; name: string; visibility: Visibility }[];
  exports: { file: string; name: string }[];
  uses: { file: string; name: string }[];
  tests: { file: string; name: string }[];
  dynamicTests: { file: string; line: number }[];
};

const sourceFiles = listFiles(groups.sources, (n) => n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.includes('.test.'));
const testFiles = listFiles(groups.tests, (n) => /\.test\.m?ts$/.test(n));
const out: Out = {
  language: 'node',
  files: sourceFiles,
  units: [],
  types: [],
  members: [],
  constants: [],
  exports: [],
  uses: [],
  tests: [],
  dynamicTests: [],
};

function modifiers(node: ts.Node): readonly ts.ModifierLike[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(node).some((m) => m.kind === kind);
}
function jsdocInternal(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'internal');
}
function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

/** Visibility of a module-level declaration: not exported is private, then @internal is internal. */
function topVisibility(node: ts.Node): Visibility {
  if (!isExported(node)) return 'private';
  return jsdocInternal(node) ? 'internal' : 'public';
}

/** Visibility of a class or interface member: the access keyword, then @internal on the member or its class. */
function memberVisibility(node: ts.Declaration, classInternal: boolean): Visibility {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword) || hasPrivateName(node)) return 'private';
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return classInternal || jsdocInternal(node) ? 'internal' : 'public';
}

function hasPrivateName(node: ts.Declaration): boolean {
  const name = ts.getNameOfDeclaration(node);
  return name !== undefined && ts.isPrivateIdentifier(name);
}

function nameOf(node: ts.NamedDeclaration): string {
  return node.name === undefined ? '' : node.name.getText().replace(/^#/, '');
}

/** The declaration text up to its body, one line, without the trailing `;`. */
function bodyOf(node: ts.Node): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    return node.body;
  }
  return undefined;
}

function headOf(node: ts.Node, sf: ts.SourceFile): string {
  const body = bodyOf(node);
  const end = body === undefined ? node.getEnd() : body.getStart(sf);
  return sf.text.slice(node.getStart(sf), end).replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
}

function parameterNames(params: readonly ts.ParameterDeclaration[]): string[] {
  return params.filter((p) => ts.isIdentifier(p.name)).map((p) => p.name.getText());
}

function readSource(file: string): void {
  const sf = ts.createSourceFile(file, readFileSync(join(root!, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const stem = file.split('/').pop()!.replace(/\.ts$/, '');
  const functions: ts.FunctionDeclaration[] = [];

  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const clause = st.exportClause;
      if (clause === undefined || ts.isNamespaceExport(clause)) {
        out.exports.push({ file, name: '*' });
      } else {
        for (const el of clause.elements) out.exports.push({ file, name: el.name.text });
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      const cls = st.name.text;
      const classInternal = jsdocInternal(st);
      out.units.push({ file, name: cls, kind: 'class', internal: classInternal });
      for (const m of st.members) readClassMember(file, sf, cls, classInternal, m);
    } else if (ts.isInterfaceDeclaration(st)) {
      readInterface(file, sf, st);
    } else if (ts.isTypeAliasDeclaration(st)) {
      readTypeAlias(file, sf, st);
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      functions.push(st);
    } else if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const visibility = isExported(st) ? (jsdocInternal(st) ? 'internal' : 'public') : 'private';
          out.constants.push({ file, name: decl.name.text, visibility });
        }
      }
    }
  }

  if (functions.length > 0) {
    out.units.push({ file, name: stem, kind: 'functions', internal: false });
    for (const fn of functions) {
      const name = nameOf(fn);
      out.members.push({
        file,
        unit: stem,
        name,
        kind: 'function',
        visibility: topVisibility(fn),
        symbol: `${file}::${name}`,
        signature: headOf(fn, sf),
        parameters: parameterNames(fn.parameters),
      });
    }
  }
}

/** Only public and internal properties are members (HYR-8): a private or protected property is not part of the surface. */
function isExposed(visibility: Visibility): boolean {
  return visibility === 'public' || visibility === 'internal';
}

function readClassMember(file: string, sf: ts.SourceFile, cls: string, classInternal: boolean, m: ts.ClassElement): void {
  if (ts.isConstructorDeclaration(m)) {
    out.members.push({
      file,
      unit: cls,
      name: 'constructor',
      kind: 'constructor',
      visibility: memberVisibility(m, classInternal),
      symbol: `${file}::${cls}.constructor`,
      signature: headOf(m, sf),
      parameters: parameterNames(m.parameters),
    });
    for (const p of m.parameters) {
      const isProperty = modifiers(p).some((mod) =>
        [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(mod.kind),
      );
      if (isProperty && ts.isIdentifier(p.name) && isExposed(memberVisibility(p, classInternal))) {
        const name = p.name.text;
        out.members.push({
          file,
          unit: cls,
          name,
          kind: 'property',
          visibility: memberVisibility(p, classInternal),
          symbol: `${file}::${cls}.${name}`,
          signature: sf.text.slice(p.getStart(sf), p.getEnd()).replace(/\s*=[\s\S]*$/, '').replace(/\s+/g, ' ').trim(),
          parameters: [],
        });
      }
    }
  } else if (ts.isMethodDeclaration(m)) {
    const name = nameOf(m);
    out.members.push({
      file,
      unit: cls,
      name,
      kind: hasModifier(m, ts.SyntaxKind.StaticKeyword) ? 'static method' : 'method',
      visibility: memberVisibility(m, classInternal),
      symbol: `${file}::${cls}.${name}`,
      signature: headOf(m, sf),
      parameters: parameterNames(m.parameters),
    });
  } else if (ts.isPropertyDeclaration(m) && isExposed(memberVisibility(m, classInternal))) {
    const name = nameOf(m);
    out.members.push({
      file,
      unit: cls,
      name,
      kind: 'property',
      visibility: memberVisibility(m, classInternal),
      symbol: `${file}::${cls}.${name}`,
      signature: sf.text.slice(m.getStart(sf), m.getEnd()).replace(/\s*=[\s\S]*$/, '').replace(/;$/, '').replace(/\s+/g, ' ').trim(),
      parameters: [],
    });
  }
}

/** An interface is a unit (kind interface) and also a type entry; the check keeps the one its words call for. */
function readInterface(file: string, sf: ts.SourceFile, st: ts.InterfaceDeclaration): void {
  const name = st.name.text;
  const interfaceInternal = jsdocInternal(st);
  out.units.push({ file, name, kind: 'interface', internal: interfaceInternal });
  const fields: string[] = [];
  for (const m of st.members) {
    if (ts.isPropertySignature(m) || ts.isMethodSignature(m)) {
      const memberName = nameOf(m);
      const isMethod = ts.isMethodSignature(m);
      if (!isMethod) fields.push(memberName);
      out.members.push({
        file,
        unit: name,
        name: memberName,
        kind: isMethod ? 'method' : 'property',
        visibility: memberVisibility(m, interfaceInternal),
        symbol: `${file}::${name}.${memberName}`,
        signature: sf.text.slice(m.getStart(sf), m.getEnd()).replace(/;$/, '').replace(/\s+/g, ' ').trim(),
        parameters: isMethod ? parameterNames(m.parameters) : [],
      });
    }
  }
  out.types.push({ file, name, visibility: topVisibility(st), declaration: st.getText(sf), fields });
}

function readTypeAlias(file: string, sf: ts.SourceFile, st: ts.TypeAliasDeclaration): void {
  const entry: Out['types'][number] = {
    file,
    name: st.name.text,
    visibility: topVisibility(st),
    declaration: st.getText(sf),
  };
  if (ts.isTypeLiteralNode(st.type)) {
    entry.fields = st.type.members.filter(ts.isPropertySignature).map((m) => nameOf(m));
  } else if (ts.isFunctionTypeNode(st.type)) {
    entry.parameters = st.type.parameters.length;
  }
  out.types.push(entry);
}

const TEST_CALLS = new Set(['describe', 'it', 'test']);

// The identifier a test call is made on: `it`, `it.each(table)` and `it.skip` all root at `it`.
function testRoot(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr)) return testRoot(expr.expression);
  return undefined;
}

// A test name must be a string literal: the spec names tests by their literal names (HYR-7). A call whose name is not one,
// or that runs an `each` table, is a dynamic test: the check reports its line (TEST_NAME_DYNAMIC) and names no test.
function isEach(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'each' || isEach(expr.expression);
  if (ts.isCallExpression(expr)) return isEach(expr.expression);
  return false;
}

function visitTests(node: ts.Node, sf: ts.SourceFile, stack: string[]): void {
  if (ts.isCallExpression(node)) {
    const root = testRoot(node.expression);
    if (root !== undefined && TEST_CALLS.has(root)) {
      const first = node.arguments[0];
      if (first === undefined || !ts.isStringLiteralLike(first) || isEach(node.expression)) {
        out.dynamicTests.push({ file: sf.fileName, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
        return;
      }
      if (root === 'describe') {
        for (const arg of node.arguments.slice(1)) visitTests(arg, sf, [...stack, first.text]);
      } else {
        out.tests.push({ file: sf.fileName, name: [...stack, first.text].join(' > ') });
      }
      return;
    }
  }
  ts.forEachChild(node, (child) => visitTests(child, sf, stack));
}

try {
  for (const file of sourceFiles) readSource(file);
  for (const file of testFiles) {
    const sf = ts.createSourceFile(file, readFileSync(join(root!, file), 'utf8'), ts.ScriptTarget.Latest, true);
    visitTests(sf, sf, []);
  }
} catch (error) {
  console.error(`read-node.mts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log(JSON.stringify(out, null, 2));
