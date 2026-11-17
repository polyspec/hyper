// Tests the native template extension (H14.1-7, H27.45, H27.51, H31.5): the recipe of template-ext builds the php-ext
// package polyspec/template of the template release with PIE from the Composer repository of that release (packages.json),
// so hyper pins no release archive of its own and builds no copy of the template repository.
// `make hyper-install` runs `make template-ext` under $(ONLINE); `make ext` of the checks only requires the built library and runs offline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
// The value of the simple variable `name` of the Makefile.
const variable = (name: string): string => {
  const value = new RegExp(`^${name} := (.+)$`, 'm').exec(read('Makefile'))?.[1];
  if (value === undefined) throw new Error(`the Makefile declares no ${name} :=`);
  return value;
};

test('PHP_INI_SCAN_DIR is set only in the env of the three PIE commands of template-ext, in no other recipe line (H35.52)', () => {
  // The data base of make (-p) prints each rule with its recipe lines unexpanded, after the line "# Make data base".
  const lines = dryRun('template-ext', { variables: ['-p'] });
  const start = lines.findIndex((line) => line.startsWith('# Make data base'));
  assert.ok(start >= 0, 'make -p prints its data base');
  const found: string[] = [];
  let target = '';
  for (const line of lines.slice(start)) {
    const rule = /^([^\s#][^=]*?):(?!=)/.exec(line);
    if (rule) target = rule[1] ?? '';
    else if (line.startsWith('\t') && line.includes('PHP_INI_SCAN_DIR')) found.push(`${target}: ${line.trim()}`);
  }
  assert.equal(found.length, 3, found.join('\n'));
  for (const line of found) assert.match(line, /^template-ext: \$\(ONLINE\) env PIE_WORKING_DIRECTORY=\$\(PIE_WORK\) COMPOSER_CACHE_DIR=\$\(PIE_WORK\)\/cache PHP_INI_SCAN_DIR=:\$\(PIE_WORK\)\/ini \$\(PIE\) /, line);
});

test('template-ext, json-ext and hyper-install-redis start their one shell with pie_run, whose trap removes the PIE working directory (HR-87, H35.53)', () => {
  const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // The data base of make holds the recipes unexpanded: the first line of each of the three is the call of the one definition.
  const base = dryRun('template-ext', { variables: ['-p'] });
  for (const [target, call] of [['template-ext', '$(call pie_run,$(PIE_WORK),build/ext.next-$$$$)'], ['json-ext', '$(call pie_run,$(JSON_PIE_WORK),build/json-ext.next-$$$$)'], ['hyper-install-redis', '$(call pie_run,$(PHPREDIS_WORK),)']] as const) {
    const at = base.findIndex((line) => line.startsWith(`${target}:`) && !line.startsWith(`${target}:=`));
    const recipe = base.slice(at + 1).find((line) => line.includes('pie_run'));
    assert.ok(recipe?.trim().startsWith(call), `${target}: ${recipe}`);
  }
  // Expanded, each trap removes the working directory and the staging of its run.
  for (const [target, work, staging] of [['template-ext', 'polyspec/template', ' build/ext.next-$$'], ['json-ext', 'polyspec/json', ' build/json-ext.next-$$'], ['hyper-install-redis', 'phpredis', '']] as const) {
    const directory = `${ROOT}/var/pie/${work}`;
    const text = dryRun(target).join('\n');
    assert.match(text, new RegExp(`rm -rf ${escape(directory)} && mkdir -p ${escape(directory)} && trap 'rm -rf ${escape(directory)}${escape(staging)}' EXIT && trap 'exit 130' INT TERM && `), text);
  }
});

test('make template-ext builds polyspec/template of TEMPLATE_VERSION with PIE in an empty folder from the Composer repository of the release (H27.45, H27.51)', () => {
  const version = variable('TEMPLATE_VERSION');
  const lines = dryRun('template-ext');
  const text = lines.join('\n');
  const packages = `https://github.com/polyspec/template/releases/download/v${version}/packages.json`;
  const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const work = `${ROOT}/var/pie/polyspec/template`;
  // PIE keeps one Composer project per target PHP in its working directory and never undoes repository:add, so each run
  // starts in an empty folder of the package and names it as PIE_WORKING_DIRECTORY of both PIE commands.
  assert.match(text, new RegExp(`rm -rf ${escape(work)} && mkdir -p ${escape(work)}`), text);
  // The dry run holds json-ext first, a prerequisite (H35.52); these are the PIE commands of the template.
  const pie = lines.filter((line) => /\/mise\/shims\/pie /.test(line) && line.includes(`PIE_WORKING_DIRECTORY=${work} `));
  assert.equal(pie.length, 3, text);
  for (const line of pie) {
    // make 3.81 keeps the tab of a continued recipe line in its dry run, and make 4 removes it.
    assert.match(line, new RegExp(`^\\t?env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK env PIE_WORKING_DIRECTORY=${escape(work)} COMPOSER_CACHE_DIR=${escape(work)}/cache PHP_INI_SCAN_DIR=:${escape(work)}/ini \\S+/var/tools/mise/shims/pie `), line);
    // Each command of the one shell of the recipe goes on only when the one before it passed.
    assert.match(line, / --no-interaction && \\$/, line);
  }
  // PIE reads the copy of the packages.json of the release that scripts/php-ext-requires.mts verified, not the URL
  // (HR-80, H35.54).
  assert.ok(!text.includes(` repository:add composer ${packages}`), text);
  assert.match(pie[0] ?? '', new RegExp(` repository:add composer ${escape(`${work}/repository/polyspec/template/packages.json`)} --no-interaction && \\\\$`));
  // The template package requires the Composer library polyspec/json, which only the repository of the json release holds,
  // so the PIE project of the template adds it after the repository of the template release (H35.52).
  assert.match(pie[1] ?? '', new RegExp(` repository:add composer ${escape(`${work}/repository/polyspec/json/packages.json`)} --no-interaction && \\\\$`));
  assert.match(pie[2] ?? '', new RegExp(` build polyspec/template:${escape(version)} --no-interaction && \\\\$`));
  // The trap of that shell removes the working directory with its Composer cache at the end, the failure and a signal of
  // the run, because no later target reads it (HR-87).
  assert.match(text, new RegExp(`trap 'rm -rf ${escape(work)} build/ext\\.next-\\$\\$' EXIT && trap 'exit 130' INT TERM`), text);
  // The template package requires ext-polyspec_json, so template-ext runs after json-ext, and PIE, which lists the extensions
  // of its target PHP by running it, reads the one ini of the run that loads the json library (H35.52).
  const json = lines.findIndex((line) => line.includes(' build polyspec/json:'));
  const ini = lines.findIndex((line) => line.includes(`printf 'extension=%s\\n' '${ROOT}/build/json-ext/polyspec_json.so' > ${work}/ini/polyspec_json.ini`));
  assert.ok(json >= 0 && ini > json && ini < lines.indexOf(pie[0] ?? ''), text);
  assert.match(text, new RegExp(`trap 'exit 130' INT TERM && mkdir -p ${escape(work)}/ini && `), text);
  // pie install writes into the PHP of the machine, and kit has no pie-build any more (kit K931).
  assert.deepEqual(lines.filter((line) => /\/pie-build\.|\bpie install\b|mise install/.test(line)), [], text);
  // The recipe takes the one library that PIE recorded with scripts/pie-binary.mts, fails with its status and publishes a file.
  assert.match(text, new RegExp(`binary=\\$\\(\\S+ scripts/pie-binary\\.mts ${escape(work)} polyspec/template\\) && \\\\\n\\t?mkdir -p build/ext\\.next-`), text);
});
