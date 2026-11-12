// Types of the recipe check (HYR-8): the development spec (contracts/interfaces.json), the protocol
// (contracts/protocol.json) and the readers' output.

export type Lang = 'php' | 'node' | 'python';
export const LANGS: Lang[] = ['php', 'node', 'python'];
export type Runner = 'php' | 'node' | 'python' | 'browser' | 'build';
export const RUNNERS: Runner[] = ['php', 'node', 'python', 'browser', 'build'];
export type Visibility = 'public' | 'internal' | 'private' | 'protected';
export type Only = { languages: Runner[]; sentence: string };

/** A JSON object as a parsed document holds it, and the check that a value is one. */
export type Json = Record<string, unknown>;
export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type Spec = {
  schema: 1;
  languages: Record<Lang, { sources: string[]; tests: string[]; barrel: string[] }>;
  runners: Record<Lang, { runner: string; steps: string; registry: string }> & Record<'browser' | 'build', { runner: string }>;
  caseReaders: Record<Lang, string>;
  outside: { rule: string; reason: string }[];
  concerns: Concern[];
  types: SpecType[];
  caseFiles: Record<string, CaseFile>;
};

export type Concern = {
  id: string;
  rules: string[];
  cases: string[] | { none: string; tests: string[] };
  units: Unit[];
};

export type Unit = {
  id: string;
  native: Partial<Record<Lang, { file: string; kind: string; internal: boolean }>>;
  members: Member[];
  only?: Only;
  tests?: string[];
};

export type Member = {
  id: string;
  kind: string;
  visibility: 'public' | 'internal' | 'private';
  inputs: string[];
  output: string;
  errors: string[];
  state: string;
  native: Partial<Record<Lang, { symbol: string; signature: string }>>;
  only?: Only;
  tests?: string[];
};

export type SpecType = {
  id: string;
  visibility: 'public' | 'internal' | 'private';
  unit: string;
  shape: { fields?: Record<string, string | { term: string; only: Only }>; optional?: string[]; function?: { inputs: string[]; output: string }; term?: string };
  only?: Only;
  native: Partial<Record<Lang, { symbol: string; declaration: string }>>;
};

/** A case file of contracts/ (HYR-9): its fixtures and its sections of cases. */
export type CaseFile = {
  fixtures: Record<string, string>;
  sections: Record<string, CaseSection>;
};

export type CaseSection = {
  runners: Runner[];
  uses: string[];
  members?: string[];
  outcomes?: Record<string, CaseCompare>;
  fields: Record<string, CaseField>;
};

export type CaseCompare = { compare: string; sentence: string; only?: Only };

export type CaseField = {
  role: string;
  optional?: boolean;
  only?: Only;
  compare?: string;
  sentence?: string;
  state?: string;
  fields?: Record<string, CaseField>;
};

export type Sources = {
  language: Lang;
  files: string[];
  units: { file: string; name: string; kind: string; internal: boolean }[];
  types: { file: string; name: string; visibility: Visibility; declaration: string; fields?: string[]; parameters?: number }[];
  members: { file: string; unit: string; name: string; kind: string; visibility: Visibility; symbol: string; signature: string; parameters: string[] }[];
  constants: { file: string; unit?: string; name: string; visibility: Visibility }[];
  exports: { file: string; name: string }[];
  uses: { file: string; name: string }[];
  tests: { file: string; name: string }[];
  dynamicTests: { file: string; line: number }[];
  // The calls of a name in a source file; only Python, whose constructor has no private form, records them (HYR-8).
  calls: { file: string; name: string; module: string }[];
  // The classes and the scopes of every file of the sources and of the test tree, and the step registry (HYR-5, HYR-7).
  classes: SourceClass[];
  scopes: Scope[];
  registry: RegistryEntry[];
};

/** The reader output of a language that has read nothing yet. */
export function emptySources<L extends Lang>(language: L): Sources & { language: L } {
  return { language, files: [], units: [], types: [], members: [], constants: [], exports: [], uses: [], tests: [], dynamicTests: [], calls: [], classes: [], scopes: [], registry: [] };
}

/** A class that a file declares, named by that file and its name. */
export type ClassRef = { file: string; name: string };

/**
 * An expression as a reader writes it (HYR-5): a receiver whose class is written, a module, a member read or call, a
 * construction, a conditional of several values, or any other expression.
 */
export type Expr =
  | { kind: 'own' }
  | { kind: 'parent' }
  | { kind: 'class'; file: string; name: string }
  | { kind: 'module'; file: string }
  | { kind: 'variable'; name: string }
  | { kind: 'new'; class: ClassRef }
  | { kind: 'member'; of: Expr; name: string; call: boolean }
  | { kind: 'either'; of: Expr[] }
  | { kind: 'other' };

/** A parameter or a property: its name, the class of its written type, and the class inside a written list type. */
export type Parameter = { name: string; type?: ClassRef; items?: ClassRef };

export type SourceClass = { file: string; name: string; extends: ClassRef[]; properties: Parameter[] };

/** A function or a method: `<Class>.<method>`, `<function>` or `steps.<property>`, with what it writes. */
export type Scope = {
  file: string;
  name: string;
  class?: string;
  parameters: Parameter[];
  uses: Expr[];
  assigns: { target: string | { own: string }; value: Expr; type?: ClassRef }[];
  loops: { variable: string; over: Expr }[];
  /** The written return type of the function, when it names one class. */
  returns?: ClassRef;
};

/** An entry of the registry of a runner: a section of a case file and the step that it maps it to. */
export type RegistryEntry = { file: string; section: string; step: { file: string; name: string } };

export type Finding = { code: string; message: string };
