// Renames statement and rule ids of contracts/protocol.json by a declared map, in the contract and in every tracked
// citation (H35.98). Usage:
//   spec-renumber.mts apply --map <file> [--root <dir>]
//   spec-renumber.mts anchor <id>... [--root <dir>]
//
// The map is JSON: {"renames": [{"from": "HY-133", "to": "HY-132", "anchor": "<sha256>"}, ...]}. An entry renames a rule
// id with the ids of its statements (HY-133 and HY-133.n), or one statement id. The anchor identifies the entry's
// statement independently of its id: the sha256 of the English text of the statement (for a rule, its first statement)
// with each citation replaced by `HY`, so that the renaming of a citation inside it keeps the anchor. `anchor` prints the
// anchors of the ids of the contract, for writing a map.
//
// The run is idempotent: when the anchor of every entry is at its `to`, the map is applied and nothing is written; when
// it is at every `from`, the map is applied; a mix, or an anchor at neither, fails without writing. The rename is two
// steps, every id to a placeholder and then every placeholder to its new id, so a swap such as HY-133 <-> HY-132 cannot
// collide. The files are the tracked files of the root, without CHANGELOG*, docs/plans/** (the history of changes,
// which names the ids of their time), the maps of config/renumber (each the record of the ids that one run moved) and
// the generated docs/spec/protocol*.md, which `make spec-docs` writes after the run. The koSource of every statement
// whose English text changed is written again. Every file is written atomically.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';

type Rename = { from: string; to: string; anchor: string };
type Statement = { id: string; en: string; rule: string };

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = 'contracts/protocol.json';
const RULE_ID = /^HYC?-[1-9][0-9]*$/u;
const STATEMENT_ID = /^HYC?-[1-9][0-9]*\.[1-9][0-9]*$/u;
// A citation: an id with no letter, digit or `.digit` after it, and no letter, digit or `-` before it.
const CITATION = /(?<![0-9A-Za-z-])HYC?-[0-9]+(?:\.[0-9]+)?(?![0-9]|\.[0-9])/gu;
const EXCLUDED = (file: string): boolean =>
  /^CHANGELOG[^/]*$/u.test(file) || file.startsWith('docs/plans/') || file.startsWith('config/renumber/') || /^docs\/spec\/protocol(\.ko)?\.md$/u.test(file);

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const anchorOf = (en: string): string => sha256(en.replace(CITATION, 'HY'));

class UsageError extends Error {}

/** The statements of a contract with an id, in document order, each with its rule. */
function statementsOf(model: unknown): Statement[] {
  const found: Statement[] = [];
  const walk = (node: unknown, rule: string | undefined): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, rule);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const own = 'kind' in node && node.kind === 'rule' && 'id' in node && typeof node.id === 'string' ? node.id : rule;
    if ('en' in node && typeof node.en === 'string' && 'id' in node && typeof node.id === 'string' && own !== undefined && STATEMENT_ID.test(node.id)) {
      found.push({ id: node.id, en: node.en, rule: own });
    }
    for (const value of Object.values(node)) walk(value, own);
  };
  walk(model, undefined);
  return found;
}

function readMap(file: string): Rename[] {
  const model: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const list = typeof model === 'object' && model !== null && 'renames' in model && Array.isArray(model.renames) ? (model.renames as unknown[]) : undefined;
  if (list === undefined || list.length === 0) throw new UsageError(`${file}: the map holds no list renames`);
  const renames: Rename[] = [];
  for (const [i, entry] of list.entries()) {
    const field = (name: string): string => {
      const value: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, name) : undefined;
      if (typeof value !== 'string') throw new UsageError(`${file}: renames/${i} has no string ${name}`);
      return value;
    };
    const rename = { from: field('from'), to: field('to'), anchor: field('anchor') };
    const kind = (id: string): string => (RULE_ID.test(id) ? 'rule' : STATEMENT_ID.test(id) ? 'statement' : 'none');
    if (kind(rename.from) === 'none' || kind(rename.from) !== kind(rename.to)) throw new UsageError(`${file}: renames/${i} renames ${rename.from} to ${rename.to}; both are rule ids or both statement ids`);
    renames.push(rename);
  }
  for (const key of ['from', 'to'] as const) {
    const seen = new Set<string>();
    for (const r of renames) {
      if (seen.has(r[key])) throw new UsageError(`${file}: ${r[key]} is the ${key} of two renames`);
      seen.add(r[key]);
    }
  }
  return renames;
}

/** The id that holds the anchor of a rename now: the rule of the statement for a rule rename, else the statement. */
function anchorIds(statements: Statement[], rename: Rename): string[] {
  const rule = RULE_ID.test(rename.from);
  const firsts = new Map<string, Statement>();
  for (const s of statements) if (!firsts.has(s.rule)) firsts.set(s.rule, s);
  const pool = rule ? [...firsts.values()] : statements;
  return pool.filter((s) => anchorOf(s.en) === rename.anchor).map((s) => (rule ? s.rule : s.id));
}

/** The new id of a citation, or the citation itself when no rename names it. */
function renamer(renames: Rename[]): (id: string) => string {
  const exact = new Map(renames.map((r) => [r.from, r.to]));
  return (id) => {
    const direct = exact.get(id);
    if (direct !== undefined) return direct;
    const dot = id.indexOf('.');
    const ruleTo = dot < 0 ? undefined : exact.get(id.slice(0, dot));
    return ruleTo === undefined ? id : ruleTo + id.slice(dot);
  };
}

/**
 * The text with every citation renamed, in two steps: each citation becomes a placeholder, a marker that the text does
 * not hold followed by the index of its new id, and then each placeholder becomes that new id.
 */
function renamed(text: string, rename: (id: string) => string): string {
  let marker = '@renumber@';
  while (text.includes(marker)) marker = `@${marker}@`;
  const targets: string[] = [];
  const held = text.replace(CITATION, (id) => {
    targets.push(rename(id));
    return `${marker}${targets.length - 1};`;
  });
  return held.split(marker).map((part, i) => {
    if (i === 0) return part;
    const end = part.indexOf(';');
    return (targets[Number(part.slice(0, end))] ?? '') + part.slice(end + 1);
  }).join('');
}

function tracked(root: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new UsageError(`git ls-files failed in ${root}: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean);
}

/** The contract text with the koSource of every statement whose English text changed written again. */
function restamped(before: string, after: string): string {
  const old = new Map(statementsOf(JSON.parse(before)).map((s) => [s.id, s.en]));
  let text = after;
  for (const s of statementsOf(JSON.parse(after))) {
    const was = [...old.entries()].find(([, en]) => en !== s.en && renamedEquals(en, s.en));
    if (was === undefined) continue;
    text = text.split(`"${sha256(was[1])}"`).join(`"${sha256(s.en)}"`);
  }
  return text;
}

/** Whether two texts differ only in their citations. */
function renamedEquals(a: string, b: string): boolean {
  return a.replace(CITATION, 'HY') === b.replace(CITATION, 'HY');
}

function apply(root: string, mapFile: string): number {
  const renames = readMap(mapFile);
  const contractText = readFileSync(path.join(root, CONTRACT), 'utf8');
  const statements = statementsOf(JSON.parse(contractText));
  let pending = 0;
  let applied = 0;
  for (const r of renames) {
    const at = anchorIds(statements, r);
    if (at.includes(r.from) && !at.includes(r.to)) pending += 1;
    else if (at.includes(r.to) && !at.includes(r.from)) applied += 1;
    else throw new UsageError(`${mapFile}: the anchor of ${r.from} -> ${r.to} is at ${at.length === 0 ? 'no id' : at.join(', ')} of ${CONTRACT}`);
  }
  if (applied === renames.length) {
    process.stdout.write(`spec-renumber: ${mapFile} is applied; nothing to write\n`);
    return 0;
  }
  if (pending !== renames.length) throw new UsageError(`${mapFile}: ${applied} renames are applied and ${pending} are not; the tree is between two maps`);

  const rename = renamer(renames);
  const writes: [string, string][] = [];
  for (const file of tracked(root)) {
    if (EXCLUDED(file)) continue;
    const full = path.join(root, file);
    const buffer = readFileSync(full);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    let next = renamed(text, rename);
    if (file === CONTRACT) next = restamped(text, next);
    if (next !== text) writes.push([full, next]);
  }
  for (const [file, text] of writes) writeFileAtomic(file, text);
  process.stdout.write(`spec-renumber: ${renames.length} renames written to ${writes.length} files; run make spec-docs\n`);
  return 0;
}

function main(argv: string[]): number {
  const args = [...argv];
  let root = repo;
  const at = args.indexOf('--root');
  if (at >= 0) {
    const value = args[at + 1];
    if (value === undefined) throw new UsageError('--root needs a directory');
    root = path.resolve(value);
    args.splice(at, 2);
  }
  const [mode, ...rest] = args;
  if (mode === 'apply' && rest.length === 2 && rest[0] === '--map' && rest[1] !== undefined) return apply(root, path.resolve(rest[1]));
  if (mode === 'anchor' && rest.length > 0) {
    const statements = statementsOf(JSON.parse(readFileSync(path.join(root, CONTRACT), 'utf8')));
    for (const id of rest) {
      const s = RULE_ID.test(id) ? statements.find((x) => x.rule === id) : statements.find((x) => x.id === id);
      if (s === undefined) throw new UsageError(`${id} is no id of ${CONTRACT}`);
      process.stdout.write(`${id} ${anchorOf(s.en)}\n`);
    }
    return 0;
  }
  throw new UsageError('usage: spec-renumber.mts apply --map <file> | anchor <id>... [--root <dir>]');
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.message.startsWith('usage:') ? 2 : 1;
}
