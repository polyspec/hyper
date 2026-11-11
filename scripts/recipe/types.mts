// Types of the recipe check (HYR-8): the development spec (contracts/interfaces.json) and the readers' output.

export type Lang = 'php' | 'node' | 'python';
export const LANGS: Lang[] = ['php', 'node', 'python'];
export type Visibility = 'public' | 'internal' | 'private' | 'protected';
export type Only = { languages: Lang[]; rule: string; quote: string };

export type Spec = {
  schema: 1;
  languages: Record<Lang, { sources: string[]; tests: string[]; barrel: string[]; runner: string }>;
  outside: { rule: string; reason: string }[];
  concerns: Concern[];
  types: SpecType[];
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
  shape: { fields?: Record<string, string | { term: string; only: Only }>; optional?: string[]; function?: unknown; term?: string };
  only?: Only;
  native: Partial<Record<Lang, { symbol: string; declaration: string }>>;
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
};

export type Finding = { code: string; message: string };
