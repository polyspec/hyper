// Checks HC-6: only the layout template of an application carries hx-* attributes.
//
// Usage: node scripts/check-templates.mjs --app examples/board

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { app: { type: 'string' } } });
if (!values.app) throw new Error('--app must name the application directory');
const templatesDir = join(values.app, 'templates');
const { layout } = JSON.parse(readFileSync(join(values.app, 'app', 'app.json'), 'utf8'));

const problems = [];
const files = listFiles(templatesDir).filter((file) => file.endsWith('.tpl'));
for (const file of files) {
  const name = relative(templatesDir, file).split(sep).join('/');
  if (name === layout) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/\shx-[a-z]/i.test(line)) problems.push(`${name}:${index + 1}: hx- attribute outside the layout (HC-6)`);
  });
}
for (const problem of problems) console.error(problem);
console.log(`${files.length} templates, ${problems.length} problem(s)`);
if (problems.length > 0) process.exit(1);

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
