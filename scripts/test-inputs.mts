#!/usr/bin/env node
// Prints the make targets whose outputs the selected script tests read (HR-85, H35.55). A test names a built input with
// requireBuilt('<targets>', ...) of tests/scripts/requires.mts, and phpServerExtensions() of that module names the
// targets `ext hyper-ext`. The script reads each selected file and every module of the checkout that it imports, by a
// relative specifier, transitively, collects those targets and prints the ones that are in TARGETS, the inputs that
// `make hyper-test-scripts` builds for the full set, in the order of TARGETS. A selection of files that read none of
// them prints nothing, so make builds nothing for it.
//
// Usage: node scripts/test-inputs.mts TARGETS FILE...
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORT = /\bfrom\s+'(\.{1,2}\/[^']+)'|\bimport\s*\(\s*'(\.{1,2}\/[^']+)'\s*\)/g;
const REQUIRE = /\brequireBuilt\(\s*'([^']+)'/g;
const EXTENSIONS = /\bphpServerExtensions\(\s*\)/;
const REQUIRES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/scripts/requires.mts');

/** The make targets that `files` and the modules that they import name as built inputs. */
export function inputs(files: string[]): Set<string> {
  const targets = new Set<string>();
  const seen = new Set<string>();
  const queue = files.map((file) => path.resolve(file));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) throw new Error(`${file}: no such file`);
    // requires.mts defines requireBuilt and phpServerExtensions; a call of either names its targets where it is made.
    if (file === REQUIRES) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(REQUIRE)) for (const target of (match[1] as string).split(/\s+/)) if (target !== '') targets.add(target);
    if (EXTENSIONS.test(text)) for (const target of ['ext', 'hyper-ext']) targets.add(target);
    for (const match of text.matchAll(IMPORT)) {
      const specifier = (match[1] ?? match[2]) as string;
      if (!/\.m?[tj]s$/.test(specifier)) continue;
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return targets;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [list, ...files] = process.argv.slice(2);
  if (list === undefined || files.length === 0) {
    process.stderr.write('Usage: node scripts/test-inputs.mts TARGETS FILE...\n');
    process.exit(2);
  }
  try {
    const found = inputs(files);
    process.stdout.write(`${list.split(/\s+/).filter((target) => found.has(target)).join(' ')}\n`);
  } catch (error) {
    process.stderr.write(`test-inputs: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
