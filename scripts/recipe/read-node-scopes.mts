// The scopes of the Node files for the recipe check (HYR-5, HYR-7): what each function and method writes about the class
// of a receiver, read from the syntax tree of each file without a program or a type checker, and the step registry of
// the case runner. A class reference names the file that declares the class and its name; the reader resolves a name
// through the relative imports of the file and leaves any other name without a class. The check (stated.mts) evaluates
// the classes; the reader resolves nothing against the spec.

import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from './typescript/node_modules/typescript/lib/typescript.js';
import type { ClassRef, Expr, Parameter, Scope, SourceClass, RegistryEntry } from './types.mts';

type Found = { kind: 'class' | 'function' | 'module' | 'steps'; file: string; name: string };
type Binding = { from: string; name: string } | { from: string; namespace: true };

const OTHER: Expr = { kind: 'other' };

/** The parsed files of the tree and the resolution of a name of a file to a class, a function or a module. */
export class NodeFiles {
  readonly tracked: Set<string>;
  readonly trees = new Map<string, ts.SourceFile>();
  private readonly declared = new Map<string, Map<string, Found>>();
  private readonly bindings = new Map<string, Map<string, Binding>>();
  private readonly reexports = new Map<string, Map<string, { from: string; name: string }>>();

  constructor(base: string, files: string[]) {
    this.tracked = new Set(files);
    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(join(base, file), 'utf8'), ts.ScriptTarget.Latest, true);
      this.trees.set(file, sf);
      this.read(file, sf);
    }
  }

  /** The tracked file that a relative module specifier of `from` names, or undefined for a package or a missing file. */
  file(from: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const target = normalize(join(dirname(from), specifier));
    const stem = target.replace(/\.(m?js|m?ts)$/u, '');
    const candidates = [target, `${stem}.ts`, `${stem}.mts`, `${stem}/index.ts`];
    return candidates.find((c) => this.tracked.has(c));
  }

  private read(file: string, sf: ts.SourceFile): void {
    const declared = new Map<string, Found>();
    const bindings = new Map<string, Binding>();
    const reexports = new Map<string, { from: string; name: string }>();
    for (const st of sf.statements) {
      if ((ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name !== undefined) declared.set(st.name.text, { kind: 'class', file, name: st.name.text });
      if (ts.isFunctionDeclaration(st) && st.name !== undefined) declared.set(st.name.text, { kind: 'function', file, name: st.name.text });
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
          const init = d.initializer;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) declared.set(d.name.text, { kind: 'function', file, name: d.name.text });
          if (d.name.text === 'steps' && ts.isObjectLiteralExpression(init)) declared.set('steps', { kind: 'steps', file, name: 'steps' });
        }
      }
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause !== undefined) {
        const from = this.file(file, st.moduleSpecifier.text);
        const named = st.importClause.namedBindings;
        if (from === undefined || named === undefined) continue;
        if (ts.isNamespaceImport(named)) bindings.set(named.name.text, { from, namespace: true });
        else for (const e of named.elements) bindings.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
      }
      if (ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined && ts.isStringLiteral(st.moduleSpecifier)) {
        const from = this.file(file, st.moduleSpecifier.text);
        const clause = st.exportClause;
        if (from === undefined || clause === undefined || !ts.isNamedExports(clause)) continue;
        for (const e of clause.elements) reexports.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
      }
    }
    this.declared.set(file, declared);
    this.bindings.set(file, bindings);
    this.reexports.set(file, reexports);
  }

  /** What a name of a file is: a class, a function or the object `steps` that the file declares, or what an import or a re-export binds. */
  resolve(file: string, name: string, depth = 0): Found | undefined {
    if (depth > 8) return undefined;
    const own = this.declared.get(file)?.get(name);
    if (own !== undefined) return own;
    const bound = this.bindings.get(file)?.get(name) ?? this.reexports.get(file)?.get(name);
    if (bound === undefined) return undefined;
    if ('namespace' in bound) return { kind: 'module', file: bound.from, name: '' };
    return this.resolve(bound.from, bound.name, depth + 1);
  }

  /** The exported object `steps` of a file: the names of its properties. */
  stepNames(file: string): string[] {
    const sf = this.trees.get(file);
    if (sf === undefined) return [];
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'steps' && d.initializer !== undefined && ts.isObjectLiteralExpression(d.initializer)) {
          return d.initializer.properties.flatMap((p) => (p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : []));
        }
      }
    }
    return [];
  }
}

/** True for a node inside a type, whose names are no reads. */
function inType(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isTypeNode(n)) return true;
    if (ts.isStatement(n)) return false;
  }
  return false;
}

/** The reading of one scope: its expressions, assignments, loops and parameters. */
class ScopeReader {
  readonly out: Scope;
  private readonly seen = new Set<string>();
  private readonly files: NodeFiles;
  private readonly file: string;

  constructor(files: NodeFiles, file: string, name: string, cls: string | undefined) {
    this.files = files;
    this.file = file;
    this.out = { file, name, parameters: [], uses: [], assigns: [], loops: [], ...(cls === undefined ? {} : { class: cls }) };
  }

  /** Records the written return type of the function: one class, also inside `Promise<…>`; `this` is the own class. */
  returns(node: ts.TypeNode | undefined): void {
    let type = node;
    if (type !== undefined && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'Promise') type = type.typeArguments?.[0];
    const written = type !== undefined && type.kind === ts.SyntaxKind.ThisType && this.out.class !== undefined ? { file: this.file, name: this.out.class } : this.typeOf(type);
    if (written !== undefined) this.out.returns = written;
  }

  classOfName(name: string): ClassRef | undefined {
    const found = this.files.resolve(this.file, name);
    return found?.kind === 'class' ? { file: found.file, name: found.name } : undefined;
  }

  /** The class of a written type: a name or a name after a namespace, also inside `| null` and `| undefined`. */
  typeOf(node: ts.TypeNode | undefined): ClassRef | undefined {
    if (node === undefined) return undefined;
    if (ts.isParenthesizedTypeNode(node)) return this.typeOf(node.type);
    if (ts.isUnionTypeNode(node)) {
      const kept = node.types.filter((t) => !(t.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)));
      const [only] = kept;
      return kept.length === 1 ? this.typeOf(only) : undefined;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName;
      if (ts.isIdentifier(name)) return this.classOfName(name.text);
      const left = name.left;
      if (ts.isIdentifier(left)) {
        const module = this.files.resolve(this.file, left.text);
        if (module?.kind === 'module') {
          const found = this.files.resolve(module.file, name.right.text);
          return found?.kind === 'class' ? { file: found.file, name: found.name } : undefined;
        }
      }
    }
    return undefined;
  }

  /** The expression tree of a node (HYR-5). */
  expression(node: ts.Expression): Expr {
    if (node.kind === ts.SyntaxKind.ThisKeyword) return { kind: 'own' };
    if (node.kind === ts.SyntaxKind.SuperKeyword) return { kind: 'parent' };
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) {
      return this.expression(node.expression);
    }
    if (ts.isIdentifier(node)) {
      const found = this.files.resolve(this.file, node.text);
      if (found === undefined) return { kind: 'variable', name: node.text };
      if (found.kind === 'class') return { kind: 'class', file: found.file, name: found.name };
      if (found.kind === 'module') return { kind: 'module', file: found.file };
      return OTHER;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const of = this.expression(node.expression);
      const name = node.name.text;
      if (of.kind === 'module') {
        const found = this.files.resolve(of.file, name);
        if (found?.kind === 'class') return { kind: 'class', file: found.file, name: found.name };
        if (found?.kind === 'module') return { kind: 'module', file: found.file };
        if (found?.kind === 'function') return { kind: 'member', of: { kind: 'module', file: found.file }, name: found.name, call: false };
      }
      return { kind: 'member', of, name, call: false };
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.SuperKeyword) return { kind: 'member', of: { kind: 'parent' }, name: 'constructor', call: true };
      if (ts.isIdentifier(callee)) {
        const found = this.files.resolve(this.file, callee.text);
        if (found?.kind === 'function') return { kind: 'member', of: { kind: 'module', file: found.file }, name: found.name, call: true };
      }
      const of = this.expression(callee);
      return of.kind === 'member' ? { ...of, call: true } : OTHER;
    }
    if (ts.isNewExpression(node)) {
      const of = this.expression(node.expression);
      return of.kind === 'class' ? { kind: 'new', class: { file: of.file, name: of.name } } : OTHER;
    }
    if (ts.isConditionalExpression(node)) return { kind: 'either', of: [this.expression(node.whenTrue), this.expression(node.whenFalse)] };
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return { kind: 'either', of: [this.expression(node.left), this.expression(node.right)] };
    }
    return OTHER;
  }

  private use(expr: Expr): void {
    if (expr.kind !== 'member' && expr.kind !== 'new') return;
    const key = JSON.stringify(expr);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.uses.push(expr);
  }

  parameters(params: readonly ts.ParameterDeclaration[]): void {
    for (const p of params) {
      if (!ts.isIdentifier(p.name)) continue;
      const type = this.typeOf(p.type);
      const entry: Parameter = type === undefined ? { name: p.name.text } : { name: p.name.text, type };
      this.out.parameters.push(entry);
    }
  }

  private target(node: ts.Expression): string | { own: string } | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) return { own: node.name.text };
    return undefined;
  }

  /** Adds the assignment of a property initializer of the class, which the constructor makes. */
  property(name: string, value: ts.Expression): void {
    this.out.assigns.push({ target: { own: name }, value: this.expression(value) });
  }

  /** Reads every node below `node`, a nested function included; an assignment target and a callee are no use of their own. */
  read(node: ts.Node): void {
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
        const type = this.typeOf(n.type);
        this.out.assigns.push({ target: n.name.text, value: n.initializer === undefined ? OTHER : this.expression(n.initializer), ...(type === undefined ? {} : { type }) });
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = this.target(n.left);
        if (target !== undefined) this.out.assigns.push({ target, value: this.expression(n.right) });
      }
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && ts.isVariableDeclarationList(n.initializer)) {
        const [d] = n.initializer.declarations;
        if (d !== undefined && ts.isIdentifier(d.name)) this.out.loops.push({ variable: d.name.text, over: this.expression(n.expression) });
      }
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) this.parameters(n.parameters);
      if ((ts.isPropertyAccessExpression(n) || ts.isCallExpression(n) || ts.isNewExpression(n)) && !inType(n)) {
        const parent = n.parent;
        const callee = ts.isCallExpression(parent) && parent.expression === n;
        const written = ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === n;
        if (!callee && !written) this.use(this.expression(n));
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
}

/** The classes and the scopes of the files (HYR-5): top-level functions and constants, class members and the properties of `steps`. */
export function readScopes(files: NodeFiles): { classes: SourceClass[]; scopes: Scope[] } {
  const classes: SourceClass[] = [];
  const scopes: Scope[] = [];
  for (const [file, sf] of files.trees) {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined) {
        const scope = new ScopeReader(files, file, st.name.text, undefined);
        scope.parameters(st.parameters);
        scope.returns(st.type);
        if (st.body !== undefined) scope.read(st.body);
        scopes.push(scope.out);
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
          const init = d.initializer;
          if (d.name.text === 'steps' && ts.isObjectLiteralExpression(init)) {
            for (const p of init.properties) {
              if (p.name === undefined || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
              const scope = new ScopeReader(files, file, `steps.${p.name.text}`, undefined);
              scope.read(p);
              scopes.push(scope.out);
            }
            continue;
          }
          const scope = new ScopeReader(files, file, d.name.text, undefined);
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) scope.returns(init.type);
          scope.read(init);
          scopes.push(scope.out);
        }
      }
      if (ts.isInterfaceDeclaration(st)) {
        // An interface is a class of the family of the classes that implement it; its members are the spec's.
        const reader = new ScopeReader(files, file, st.name.text, undefined);
        const extendsOf: ClassRef[] = [];
        for (const clause of st.heritageClauses ?? []) {
          for (const t of clause.types) {
            const expr = reader.expression(t.expression);
            if (expr.kind === 'class') extendsOf.push({ file: expr.file, name: expr.name });
          }
        }
        classes.push({ file, name: st.name.text, extends: extendsOf, properties: [] });
      }
      if (ts.isClassDeclaration(st) && st.name !== undefined) {
        const cls = st.name.text;
        const reader = new ScopeReader(files, file, cls, undefined);
        const extendsOf: ClassRef[] = [];
        for (const clause of st.heritageClauses ?? []) {
          for (const t of clause.types) {
            const expr = reader.expression(t.expression);
            if (expr.kind === 'class') extendsOf.push({ file: expr.file, name: expr.name });
          }
        }
        const properties: { name: string; type?: ClassRef }[] = [];
        const constructor = new ScopeReader(files, file, `${cls}.constructor`, cls);
        let hasConstructor = false;
        for (const m of st.members) {
          if (ts.isPropertyDeclaration(m) && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
            const type = reader.typeOf(m.type);
            properties.push(type === undefined ? { name: m.name.text } : { name: m.name.text, type });
            if (m.initializer !== undefined) {
              constructor.property(m.name.text, m.initializer);
              constructor.read(m.initializer);
            }
          }
          if (ts.isConstructorDeclaration(m)) {
            hasConstructor = true;
            for (const p of m.parameters) {
              if (ts.isIdentifier(p.name) && ts.canHaveModifiers(p) && (ts.getModifiers(p) ?? []).length > 0) {
                const type = reader.typeOf(p.type);
                properties.push(type === undefined ? { name: p.name.text } : { name: p.name.text, type });
              }
            }
            constructor.parameters(m.parameters);
            if (m.body !== undefined) constructor.read(m.body);
          }
          if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
            const scope = new ScopeReader(files, file, `${cls}.${m.name.text}`, cls);
            scope.parameters(m.parameters);
            scope.returns(m.type);
            if (m.body !== undefined) scope.read(m.body);
            scopes.push(scope.out);
          }
        }
        if (hasConstructor || constructor.out.assigns.length > 0 || constructor.out.uses.length > 0) scopes.push(constructor.out);
        classes.push({ file, name: cls, extends: extendsOf, properties });
      }
    }
  }
  return { classes, scopes };
}

/**
 * The entries of the registry file: each `...prefixed('<case file>', <name>)` of it, where an import binds the name to
 * the object `steps` of a step file, gives one entry for each property of that object.
 */
export function readRegistry(files: NodeFiles, file: string): RegistryEntry[] {
  const sf = files.trees.get(file);
  if (sf === undefined) throw new Error(`the registry ${file} is no tracked file`);
  const entries: RegistryEntry[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'prefixed') {
      const [caseFile, steps] = n.arguments;
      if (caseFile !== undefined && ts.isStringLiteral(caseFile) && steps !== undefined && ts.isIdentifier(steps)) {
        const found = files.resolve(file, steps.text);
        if (found?.kind === 'steps') {
          for (const section of files.stepNames(found.file)) entries.push({ file: caseFile.text, section, step: { file: found.file, name: `steps.${section}` } });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return entries;
}
