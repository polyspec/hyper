// The protocol documents (docs/spec/protocol.md and protocol.ko.md) rendered from contracts/protocol.json (plan H2).
// Both modes first validate the model against scripts/schema/protocol.schema.json and the semantic rules: statement ids
// and their numbering, koSource, and one sentence (HYR-6) per English statement. `write` renders the documents; `check`
// also fails when a committed document differs from its rendering. Usage: spec-docs.mts write|check [--root <dir>]
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { SchemaObject } from 'ajv';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentences } from './recipe/rules.mts';

type Lang = 'en' | 'ko';
type Text = { en: string; ko: string };
type Statement = Text & { id?: string; koSource: string; term?: string };
type Item = { statements: Statement[]; blocks: Block[] };
type Block =
  | { kind: 'paragraph'; statements: Statement[] }
  | { kind: 'list'; ordered: boolean; items: Item[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'table'; header: Text[]; rows: Text[][] }
  | { kind: 'rule'; id: string; retired: number[]; blocks: Block[] };
type Contract = {
  docId: string;
  title: Text;
  intro: Block[];
  sections: { title: Text; blocks: Block[] }[];
  retiredRules: string[];
};
type Rule = { id: string; used: Set<number> };

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const GENERATED: Record<Lang, string> = {
  en: '<!-- Generated from contracts/protocol.json; DO NOT EDIT. -->',
  ko: '<!-- contracts/protocol.json에서 생성됨. 직접 수정하지 않는다. -->',
};

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The semantic rules the schema cannot state: statement ids and their numbering, koSource, one English sentence. */
function semanticProblems(contract: Contract): string[] {
  const problems: string[] = [];
  const ruleIds = new Set<string>();
  const statementIds = new Set<string>();

  const statements = (list: Statement[], rule: Rule | undefined): void => {
    for (const s of list) {
      const label = s.id ?? `"${s.en}"`;
      if (rule) {
        if (s.id === undefined) {
          problems.push(`${label}: a statement of rule ${rule.id} needs an id`);
        } else {
          const match = /^(.*)\.([0-9]+)$/.exec(s.id);
          if (match?.[1] !== rule.id) problems.push(`statement id ${s.id} is not in rule ${rule.id}`);
          else rule.used.add(Number(match[2]));
        }
      } else if (s.id !== undefined) {
        problems.push(`statement id ${s.id} is outside a rule`);
      }
      if (s.id !== undefined) {
        if (statementIds.has(s.id)) problems.push(`duplicate statement id ${s.id}`);
        statementIds.add(s.id);
      }
      const sha = sha256(s.en);
      if (s.koSource !== sha) problems.push(`${label}: koSource is stale; the sha256 of its en is ${sha}`);
      const count = sentences(s.en).length;
      if (count !== 1) problems.push(`${label} is ${count} sentences by HYR-6; a statement is one sentence`);
    }
  };

  const blocks = (list: Block[], rule: Rule | undefined): void => {
    for (const block of list) {
      switch (block.kind) {
        case 'paragraph':
          statements(block.statements, rule);
          break;
        case 'list':
          for (const item of block.items) {
            statements(item.statements, rule);
            blocks(item.blocks, rule);
          }
          break;
        case 'code':
          break;
        case 'table':
          for (const row of block.rows) {
            if (row.length !== block.header.length) {
              problems.push(`table row has ${row.length} cells; its header has ${block.header.length}`);
            }
          }
          break;
        case 'rule': {
          if (block.blocks[0]?.kind !== 'paragraph') problems.push(`rule ${block.id} must begin with a paragraph`);
          if (ruleIds.has(block.id)) problems.push(`duplicate rule id ${block.id}`);
          ruleIds.add(block.id);
          const own: Rule = { id: block.id, used: new Set() };
          blocks(block.blocks, own);
          numbering(own, block.retired);
          break;
        }
      }
    }
  };

  const numbering = (rule: Rule, retired: number[]): void => {
    for (const n of retired) {
      if (rule.used.has(n)) problems.push(`statement id ${rule.id}.${n} is used and retired`);
    }
    const taken = new Set([...rule.used, ...retired]);
    const max = Math.max(0, ...taken);
    for (let n = 1; n <= max; n++) {
      if (!taken.has(n)) problems.push(`numbering gap in ${rule.id}: ${n} is neither used nor retired`);
    }
  };

  blocks(contract.intro, undefined);
  for (const section of contract.sections) blocks(section.blocks, undefined);
  for (const id of contract.retiredRules) {
    if (ruleIds.has(id)) problems.push(`${id} is a rule and in retiredRules`);
  }
  return problems;
}

function inline(list: Statement[], lang: Lang): string {
  return list.map((s) => (s.id === undefined ? '' : `<a id="${s.id}"></a> `) + s[lang]).join(' ');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `  ${line}`))
    .join('\n');
}

function renderBlock(block: Block, lang: Lang): string {
  switch (block.kind) {
    case 'paragraph':
      return inline(block.statements, lang);
    case 'code':
      return ['```' + block.language, block.text, '```'].join('\n');
    case 'table': {
      const row = (cells: Text[]): string => `| ${cells.map((c) => c[lang]).join(' | ')} |`;
      const rule = `| ${block.header.map(() => '---').join(' | ')} |`;
      return [row(block.header), rule, ...block.rows.map(row)].join('\n');
    }
    case 'list':
      return block.items
        .map((item, i) => {
          let text = (block.ordered ? `${i + 1}. ` : '- ') + inline(item.statements, lang);
          for (const nested of item.blocks) text += '\n\n' + indent(renderBlock(nested, lang));
          return text;
        })
        .join('\n');
    case 'rule': {
      const [head, ...rest] = block.blocks;
      let text = `- **${block.id}** ` + (head?.kind === 'paragraph' ? inline(head.statements, lang) : '');
      for (const nested of rest) text += '\n\n' + indent(renderBlock(nested, lang));
      return text;
    }
  }
}

/** One document: the title, the header comment, the intro, then each section as `## title` and its blocks. */
function render(contract: Contract, lang: Lang, englishSha?: string): string {
  const head = [`<!-- doc-id: ${contract.docId} -->`];
  if (englishSha !== undefined) head.push(`<!-- source-sha256: ${englishSha} -->`);
  head.push(`# ${contract.title[lang]}`);
  const chunks = [head.join('\n'), GENERATED[lang], ...contract.intro.map((b) => renderBlock(b, lang))];
  for (const section of contract.sections) {
    chunks.push(`## ${section.title[lang]}`, ...section.blocks.map((b) => renderBlock(b, lang)));
  }
  return chunks.join('\n\n') + '\n';
}

function firstDifferentLine(actual: string, expected: string): number {
  const a = actual.split('\n');
  const e = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) return i + 1;
  }
  return 1;
}

function usage(): number {
  process.stderr.write('usage: spec-docs.mts write|check [--root <dir>]\n');
  return 2;
}

function main(argv: string[]): number {
  const [mode, ...rest] = argv;
  if (mode !== 'write' && mode !== 'check') return usage();
  let root = repo;
  if (rest.length > 0) {
    if (rest.length !== 2 || rest[0] !== '--root' || rest[1] === undefined) return usage();
    root = path.resolve(rest[1]);
  }

  const problems: string[] = [];
  const contractPath = path.join(root, 'contracts', 'protocol.json');
  let model: unknown;
  try {
    model = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    problems.push(`contracts/protocol.json: ${(error as Error).message}`);
  }

  if (model !== undefined) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const schema = JSON.parse(readFileSync(path.join(here, 'schema', 'protocol.schema.json'), 'utf8')) as SchemaObject;
    const validate = ajv.compile(schema);
    if (validate(model)) {
      problems.push(...semanticProblems(model as Contract));
    } else {
      for (const error of validate.errors ?? []) {
        problems.push(`contracts/protocol.json${error.instancePath}: ${error.message}`);
      }
    }
  }

  if (problems.length > 0 || model === undefined) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    return 1;
  }

  const contract = model as Contract;
  const english = render(contract, 'en');
  const korean = render(contract, 'ko', sha256(english));
  const outputs: [string, string][] = [
    [`${contract.docId}.md`, english],
    [`${contract.docId}.ko.md`, korean],
  ];
  const specDir = path.join(root, 'docs', 'spec');

  if (mode === 'write') {
    mkdirSync(specDir, { recursive: true });
    for (const [name, text] of outputs) writeFileSync(path.join(specDir, name), text);
    return 0;
  }

  for (const [name, expected] of outputs) {
    const rel = `docs/spec/${name}`;
    const file = path.join(specDir, name);
    if (!existsSync(file)) {
      problems.push(`${rel} is missing; run make spec-docs`);
      continue;
    }
    const actual = readFileSync(file, 'utf8');
    if (actual !== expected) problems.push(`${rel} differs from its generation at line ${firstDifferentLine(actual, expected)}`);
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  return problems.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
