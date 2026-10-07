// Builds the template files of a template directory without an application bundle, for the tests of the Node
// server package (HY-34):
//   <output>/templates/<name>.<hash>.json  one AST file per template, including hyper/data.tpl
//   <output>/templates.index.json          template name -> file URL (/templates/<file>)
//
// The template ASTs come from the template package `@polyspec/template` that this repository installs (HY-70).
//
// Usage: node scripts/build-templates.mjs --templates packages/hyper-php/tests/fixtures/templates --output packages/hyper-node/tests/build


import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from './output-files.mjs';
import { writeTemplateFiles } from './template-files.mjs';

const { values } = parseArgs({ options: { templates: { type: 'string' }, output: { type: 'string' } } });
if (!values.templates || !values.output) throw new Error('--templates and --output are required');
const index = await writeTemplateFiles({ templates: values.templates, output: join(values.output, 'templates'), urlPrefix: '/templates' });
writeFileAtomic(join(values.output, 'templates.index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`templates ${Object.keys(index).length}, ${join(values.output, 'templates.index.json')}`);
