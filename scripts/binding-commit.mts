// Prints the commit of the polyspec-binding-core that polyspec-hyper depends on in Cargo.lock (G-6, CK-20), the commit
// whose binding cli make install-binding installs. A lock can hold a second polyspec-binding-core that another library of
// the core requires at another source; Cargo then names the version in the dependency line of polyspec-hyper.
//   node scripts/binding-commit.mts <Cargo.lock>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Stanza {
  name: string;
  version: string;
  source: string | undefined;
  dependencies: string[];
}

// The [[package]] stanzas of a Cargo.lock: their name, version, source and dependency lines.
function stanzas(text: string): Stanza[] {
  const out: Stanza[] = [];
  for (const block of text.split(/^\[\[package\]\]$/mu).slice(1)) {
    const field = (key: string) => new RegExp(`^${key} = "([^"]*)"$`, 'mu').exec(block)?.[1];
    const list = /^dependencies = \[\n([\s\S]*?)^\]$/mu.exec(block)?.[1] ?? '';
    const dependencies = [...list.matchAll(/^ "([^"]+)",$/gmu)].map((match) => match[1] ?? '');
    out.push({ name: field('name') ?? '', version: field('version') ?? '', source: field('source'), dependencies });
  }
  return out;
}

export function bindingCommit(text: string): string {
  const all = stanzas(text);
  const hyper = all.find((s) => s.name === 'polyspec-hyper' && s.source === undefined);
  const line = hyper?.dependencies.find((d) => d === 'polyspec-binding-core' || d.startsWith('polyspec-binding-core '));
  if (line === undefined) throw new Error('polyspec-hyper names no polyspec-binding-core in Cargo.lock');
  const version = line.split(' ')[1];
  const candidates = all.filter((s) => s.name === 'polyspec-binding-core' && (version === undefined || s.version === version));
  const [core, ...others] = candidates;
  if (core === undefined || others.length > 0) throw new Error(`Cargo.lock holds ${candidates.length} packages for ${line}`);
  const commit = /#([0-9a-f]{40})$/u.exec(core.source ?? '')?.[1];
  if (commit === undefined) throw new Error(`polyspec-binding-core ${core.version} has no pinned commit: ${core.source ?? 'no source'}`);
  return commit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (path === undefined || process.argv.length !== 3) throw new Error('usage: binding-commit.mts <Cargo.lock>');
  process.stdout.write(`${bindingCommit(readFileSync(path, 'utf8'))}\n`);
}
