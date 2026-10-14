#!/usr/bin/env node
// Publishes a staging directory that a build wrote, such as the dist of an npm package, with `publish` of
// packages/build/lib/publish.mjs (HY-82): each file moves into the target with one rename, so a reader never finds a
// file missing.
//
//   node scripts/publish.mts directory <staging directory> <target>
import { fileURLToPath } from 'node:url';
import { publish } from '../packages/build/lib/publish.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, source, target] = process.argv.slice(2);
  try {
    if (!source || !target) throw new Error('Usage: node scripts/publish.mts directory <source> <target>');
    if (action !== 'directory') throw new Error(`unknown action ${action}; expected directory`);
    const result = publish(source, target);
    console.log(`publish: ${source} -> ${target} (${result.files} files${result.removed.length > 0 ? `; removed ${result.removed.join(' ')}` : ''})`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
