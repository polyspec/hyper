// Checks the templates of an application with the rules of packages/hyper-build/lib/template-rules.mjs (HC-6, HY-3,
// HY-30, HY-75).
//
// Usage: node scripts/check-templates.mjs --app examples/board

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse, resolvePath } from '@polyspec/template';
import { templateProblems } from '../packages/hyper-build/lib/template-rules.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' } } });
if (!values.app) throw new Error('--app must name the application directory');
const manifest = JSON.parse(readFileSync(join(values.app, 'app', 'app.json'), 'utf8'));
const { problems, templates } = templateProblems({ manifest, templatesDir: join(values.app, 'templates'), parse, resolvePath });
for (const problem of problems) console.error(problem);
console.log(`${templates} templates, ${problems.length} problem(s)`);
if (problems.length > 0) process.exit(1);
