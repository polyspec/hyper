// The read paths of templates and routes, and the data that they keep (HY-73). A read node is `true` when the value
// at its path is read whole, and otherwise names the keys read below it and, under `each`, what is read of every
// entry of a map or element of a list. This module imports only types, so that scripts/build-server.mjs runs it with
// the type stripping of Node and without a bundler, also in a Linux container (HY-68).
import type { MapValue, Template, Value } from '@polyspec/template/render';
import type { Manifest } from './manifest.js';

// Resolves a path of an include or block tag against the name of the template that contains it (RT-9).
export type ResolvePath = (from: string, path: string) => string;

export type ReadNode = true | { keys?: Record<string, ReadNode>; each?: ReadNode };

// The read nodes of one route: of its shared data and of the data of each region.
export interface RouteReads {
  shared: ReadNode;
  regions: Record<string, ReadNode>;
}

// A step of a path: a map key or list index, or EACH for every entry.
const EACH = null;
type Step = string | typeof EACH;
type Path = Step[];

type Expr = { type: string; [field: string]: unknown };
type Statement = { type: string; [field: string]: unknown };

// Returns the read node of a template and of every template that it includes or places by path.
export function templateReads(load: (name: string) => Template, resolve: ResolvePath, name: string): ReadNode {
  const reads = new Reads(load, resolve);
  reads.template(name, new Map(), []);
  return reads.root;
}

// Returns the read nodes of every route of a manifest (HY-73).
export function routeReads(manifest: Manifest, load: (name: string) => Template, resolve: ResolvePath): Record<string, RouteReads> {
  const regions = manifest.regions.flatMap((region) => (region.template === undefined ? [] : [[region.name, region.template] as const]));
  const page = manifest.regions.find((region) => region.page === true)!.name;
  const cache = new Map<string, ReadNode>();
  const read = (name: string): ReadNode => {
    let node = cache.get(name);
    if (node === undefined) {
      node = templateReads(load, resolve, name);
      cache.set(name, node);
    }
    return node;
  };
  const result: Record<string, RouteReads> = {};
  for (const route of manifest.routes) {
    const routeRegions = route.regions ?? [];
    const named: Record<string, ReadNode> = {};
    for (const [region, template] of regions) named[region] = read(template);
    named[page] = read(route.template);
    let server = false;
    for (const region of routeRegions) {
      let node = read(region.template);
      for (const [path, kind] of Object.entries(region.keep ?? {})) {
        node = merge(node, pathNode(path.split('.')));
        if (kind === 'server') server = true;
      }
      named[region.name] = node;
    }
    let shared: ReadNode = merge(read(manifest.layout), read(manifest.title));
    for (const node of Object.values(named)) shared = merge(shared, node);
    if (server) shared = merge(shared, pathNode(['csrf']));
    result[route.name] = { shared, regions: named };
  }
  return result;
}

// Returns the part of a value that a read node keeps: a map keeps the named keys and every key under `each`, a list
// keeps its length with null at an index that nothing names, and any other value stays as it is.
export function keepRead(value: Value, node: ReadNode): Value {
  if (node === true) return value;
  if (value instanceof Map) {
    const kept: MapValue = new Map();
    for (const [key, item] of value) {
      const child = childNode(node, key);
      if (child !== undefined) kept.set(key, keepRead(item, child));
    }
    return kept;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const child = childNode(node, String(index));
      return child === undefined ? null : keepRead(item, child);
    });
  }
  return value;
}

function childNode(node: Exclude<ReadNode, true>, key: string): ReadNode | undefined {
  const named = node.keys !== undefined && Object.hasOwn(node.keys, key) ? node.keys[key] : undefined;
  if (named === undefined) return node.each;
  return node.each === undefined ? named : merge(named, node.each);
}

// Returns the node that reads one path whole.
function pathNode(path: Path): ReadNode {
  let node: ReadNode = true;
  for (let index = path.length - 1; index >= 0; index--) {
    const step = path[index]!;
    node = step === EACH ? { each: node } : { keys: { [step]: node } };
  }
  return node;
}

function merge(a: ReadNode, b: ReadNode): ReadNode {
  if (a === true || b === true) return true;
  const result: { keys?: Record<string, ReadNode>; each?: ReadNode } = {};
  if (a.keys !== undefined || b.keys !== undefined) {
    const keys: Record<string, ReadNode> = { ...a.keys };
    for (const [key, node] of Object.entries(b.keys ?? {})) keys[key] = Object.hasOwn(keys, key) ? merge(keys[key]!, node) : node;
    result.keys = keys;
  }
  if (a.each !== undefined || b.each !== undefined) result.each = a.each === undefined ? b.each : b.each === undefined ? a.each : merge(a.each, b.each);
  return result;
}

// The scope of one rendered template file: its local variables, the loop variables that the loops bind while their
// bodies are read, with the paths of their sources, and the paths of its context names (the scope arguments of a
// block); other names are root paths (RT-11, RT-26). A loop variable exists only in the body of its loop, so it is not
// a local variable of the scope.
interface Scope {
  locals: Map<string, Map<string, Path>>;
  bound: { name: string; paths: Path[] }[];
  context: Map<string, Path[]>;
  changed: boolean;
}

class Reads {
  root: ReadNode = {};
  private readonly load: (name: string) => Template;
  private readonly resolve: ResolvePath;

  constructor(load: (name: string) => Template, resolve: ResolvePath) {
    this.load = load;
    this.resolve = resolve;
  }

  // Reads a template in a new scope until its local variables hold every path that an assignment gives them.
  template(name: string, context: Map<string, Path[]>, placing: string[]): void {
    const scope: Scope = { locals: new Map(), bound: [], context, changed: true };
    const placed = [...placing, name];
    while (scope.changed) {
      scope.changed = false;
      this.statements(this.load(name).body as unknown as Statement[], name, scope, placed, [name]);
    }
  }

  private statements(nodes: Statement[], name: string, scope: Scope, placing: string[], including: string[]): void {
    for (const node of nodes) this.statement(node, name, scope, placing, including);
  }

  private statement(node: Statement, name: string, scope: Scope, placing: string[], including: string[]): void {
    switch (node.type) {
      case 'Echo':
        this.whole(this.expr(node.expr as Expr, scope));
        return;
      case 'If':
        for (const branch of node.branches as { test: Expr; body: Statement[] }[]) {
          this.whole(this.expr(branch.test, scope));
          this.statements(branch.body, name, scope, placing, including);
        }
        if (node.else !== null) this.statements(node.else as Statement[], name, scope, placing, including);
        return;
      case 'For': {
        const each = this.expr(node.iter as Expr, scope).map((path) => [...path, EACH]);
        for (const path of each) this.part(path);
        scope.bound.push({ name: node.name as string, paths: each });
        this.statements(node.body as Statement[], name, scope, placing, including);
        scope.bound.pop();
        if (node.empty !== null) this.statements(node.empty as Statement[], name, scope, placing, including);
        return;
      }
      case 'Set':
        this.assign(scope, node.name as string, this.expr(node.expr as Expr, scope));
        return;
      case 'Include': {
        const target = this.resolve(name, node.path as string);
        if (including.includes(target)) return;
        this.statements(this.load(target).body as unknown as Statement[], target, scope, placing, [...including, target]);
        return;
      }
      case 'Block': {
        const args = (node.scope as { name: string; expr: Expr }[]).map((item) => [item.name, this.expr(item.expr, scope)] as const);
        if (node.path === null) return;
        const target = this.resolve(name, node.path as string);
        // Placing a template that is already being placed fails when it renders (RT-22), so it reads nothing.
        if (placing.includes(target)) return;
        this.template(target, new Map(args), placing);
        return;
      }
      case 'IfBlock':
        this.statements(node.body as Statement[], name, scope, placing, including);
        if (node.else !== null) this.statements(node.else as Statement[], name, scope, placing, including);
        return;
      default:
        return;
    }
  }

  // Returns the paths of an expression and reads whole the paths of the values that it uses.
  private expr(expr: Expr, scope: Scope): Path[] {
    switch (expr.type) {
      case 'Var':
        return this.variable(expr.name as string, scope);
      case 'LoopMeta':
        return expr.field === 'value_' ? this.variable(expr.loop as string, scope) : [];
      case 'Member':
        return this.expr(expr.object as Expr, scope).map((path) => [...path, expr.key as string]);
      case 'Index': {
        const index = expr.index as Expr;
        if (index.type === 'Literal' && (index.kind === 'string' || index.kind === 'number')) {
          return this.expr(expr.object as Expr, scope).map((path) => [...path, String(index.value)]);
        }
        this.whole(this.expr(expr.object as Expr, scope));
        this.whole(this.expr(index, scope));
        return [];
      }
      case 'Binary':
        if (expr.op === '??') return [...this.expr(expr.left as Expr, scope), ...this.expr(expr.right as Expr, scope)];
        this.whole(this.expr(expr.left as Expr, scope));
        this.whole(this.expr(expr.right as Expr, scope));
        return [];
      case 'Ternary': {
        const test = this.expr(expr.test as Expr, scope);
        this.whole(test);
        const then = expr.then === null ? test : this.expr(expr.then as Expr, scope);
        return [...then, ...this.expr(expr.else as Expr, scope)];
      }
      case 'Unary':
        this.whole(this.expr(expr.operand as Expr, scope));
        return [];
      case 'Call':
      case 'ClassCall':
        for (const arg of expr.args as Expr[]) this.whole(this.expr(arg, scope));
        return [];
      case 'MemberCall':
        this.whole(this.expr(expr.object as Expr, scope));
        for (const arg of expr.args as Expr[]) this.whole(this.expr(arg, scope));
        return [];
      case 'List':
        for (const item of expr.items as Expr[]) this.whole(this.expr(item.type === 'Spread' ? (item.expr as Expr) : item, scope));
        return [];
      case 'Map':
        for (const entry of expr.entries as (Expr | { key: Expr; value: Expr })[]) {
          if ('type' in entry) {
            this.whole(this.expr(entry.expr as Expr, scope));
          } else {
            this.whole(this.expr(entry.key, scope));
            this.whole(this.expr(entry.value, scope));
          }
        }
        return [];
      default:
        return [];
    }
  }

  // Returns the paths of a name: inside the body of a loop that binds it, the paths of the loop source followed by
  // `*` and of its assignments; otherwise the paths of its local variable together with its context paths, or its
  // root path.
  private variable(name: string, scope: Scope): Path[] {
    const local = [...(scope.locals.get(name)?.values() ?? [])];
    const loop = [...scope.bound].reverse().find((binding) => binding.name === name);
    if (loop !== undefined) return [...loop.paths, ...local];
    return [...local, ...(scope.context.get(name) ?? [[name]])];
  }

  private assign(scope: Scope, name: string, paths: Path[]): void {
    let local = scope.locals.get(name);
    if (local === undefined) {
      local = new Map();
      scope.locals.set(name, local);
    }
    for (const path of paths) {
      const key = JSON.stringify(path);
      if (!local.has(key)) {
        local.set(key, path);
        scope.changed = true;
      }
    }
  }

  private whole(paths: Path[]): void {
    for (const path of paths) this.root = merge(this.root, pathNode(path));
  }

  // Reads a path in part: the entries of a loop.
  private part(path: Path): void {
    let node: ReadNode = {};
    for (let index = path.length - 1; index >= 0; index--) {
      const step = path[index]!;
      node = step === EACH ? { each: node } : { keys: { [step]: node } };
    }
    this.root = merge(this.root, node);
  }
}
