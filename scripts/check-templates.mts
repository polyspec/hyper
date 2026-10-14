// Checks the templates of an application with the rules of packages/build/lib/template-rules.mjs (HC-6, HY-3,
// HY-30, HY-75).
//
// Usage: node scripts/check-templates.mts --app examples/board

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse, resolvePath } from '@polyspec/template';
import { templateProblems } from '../packages/build/lib/template-rules.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' } } });
if (!values.app) throw new Error('--app must name the application directory');
const manifest: unknown = JSON.parse(readFileSync(join(values.app, 'app', 'app.json'), 'utf8'));
const result = templateProblems({ manifest, templatesDir: join(values.app, 'templates'), parse, resolvePath });
// template-rules.mjs is JavaScript without types: the problems are lines of text and templates is their number.
const problems: unknown = result.problems;
if (!Array.isArray(problems)) throw new TypeError(`templateProblems returned the problems as ${String(problems)}`);
const templates: unknown = result.templates;
if (typeof templates !== 'number') throw new TypeError(`templateProblems counted the templates as ${String(templates)}`);
for (const problem of problems) console.error(problem);
console.log(`${templates} templates, ${problems.length} problem(s)`);
if (problems.length > 0) process.exit(1);
