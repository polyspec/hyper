// Builds the template files of a template directory without an application bundle, for the tests of the Node
// server package (HY-34):
//   <output>/templates/<name>.<hash>.json  one AST file per template, including hyper/data.tpl
//   <output>/templates.index.json          template name -> file URL (/templates/<file>) and referenced templates
//
// The template ASTs come from the template package of the template repository --template-dir (HY-70).
//
// Usage: node scripts/build-templates.mjs --templates packages/hyper-php/tests/fixtures/templates --output packages/hyper-node/tests/build
//          --template-dir ../template

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { writeTemplateFiles } from './template-files.mjs';

const { values } = parseArgs({ options: { templates: { type: 'string' }, output: { type: 'string' }, 'template-dir': { type: 'string' } } });
if (!values.templates || !values.output || !values['template-dir']) throw new Error('--templates, --output and --template-dir are required');
const index = await writeTemplateFiles({ templates: values.templates, output: join(values.output, 'templates'), urlPrefix: '/templates', templateDir: values['template-dir'] });
mkdirSync(values.output, { recursive: true });
writeFileSync(join(values.output, 'templates.index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`templates ${Object.keys(index).length}, ${join(values.output, 'templates.index.json')}`);
