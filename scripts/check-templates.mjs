// Checks HC-6: only the layout template of an application carries hx-* attributes; and HY-3: the
// layout places {# title}, {# data} and every manifest region exactly once.
//
// Usage: node scripts/check-templates.mjs --app examples/board

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from '@polyspec/template';

const { values } = parseArgs({ options: { app: { type: 'string' } } });
if (!values.app) throw new Error('--app must name the application directory');
const templatesDir = join(values.app, 'templates');
const manifest = JSON.parse(readFileSync(join(values.app, 'app', 'app.json'), 'utf8'));
const { layout } = manifest;

const problems = [];
const files = listFiles(templatesDir).filter((file) => file.endsWith('.tpl'));
for (const file of files) {
  const name = relative(templatesDir, file).split(sep).join('/');
  if (name === layout) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/\shx-[a-z]/i.test(line)) problems.push(`${name}:${index + 1}: hx- attribute outside the layout (HC-6)`);
  });
}
const blocks = new Map();
const visit = (node) => {
  if (Array.isArray(node)) return node.forEach(visit);
  if (node === null || typeof node !== 'object') return;
  if (node.type === 'Block' && typeof node.id === 'string' && node.path === null) blocks.set(node.id, (blocks.get(node.id) ?? 0) + 1);
  Object.values(node).forEach(visit);
};
visit(parse(readFileSync(join(templatesDir, layout)), layout).body);
for (const id of ['title', 'data', ...manifest.regions.map((region) => region.name)]) {
  if (blocks.get(id) !== 1) problems.push(`${layout}: places {# ${id}} ${blocks.get(id) ?? 0} times, expected once (HY-3)`);
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
