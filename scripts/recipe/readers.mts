// Runs the three readers over a tree (HYR-8). Each reader prints the Sources document of its language on stdout;
// the document must pass scripts/schema/recipe-sources.schema.json before the check reads it.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ValidateFunction } from 'ajv';
import type { Lang, Sources, Spec } from './types.mts';

const here = path.dirname(fileURLToPath(import.meta.url));

function command(lang: Lang): [string, string[]] {
  if (lang === 'php') return [process.env.RECIPE_PHP ?? 'php', [path.join(here, 'read-php.php')]];
  if (lang === 'node') return [process.execPath, [path.join(here, 'read-node.mts')]];
  return [process.env.RECIPE_PYTHON ?? 'python3', [path.join(here, 'read_python.py')]];
}

/**
 * Runs the reader of one language over the given source and test dirs; a reader that fails or prints an invalid
 * document stops the check. `extra` are the reader's options.
 */
export function readTree(
  root: string,
  lang: Lang,
  sources: string[],
  tests: string[],
  validate: ValidateFunction<Sources>,
  extra: string[] = [],
): Sources {
  const [bin, prefix] = command(lang);
  const args = [root, ...extra, '--sources', ...sources, '--tests', ...tests];
  const result = spawnSync(bin, [...prefix, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr;
    throw new Error(`READER_FAILED ${lang}: ${detail.trim()}`);
  }
  const data: unknown = JSON.parse(result.stdout);
  if (!validate(data)) {
    throw new Error(`READER_OUTPUT ${lang}: ${validate.errors?.[0]?.instancePath ?? ''} ${validate.errors?.[0]?.message ?? ''}`);
  }
  return data;
}

/** The sources and tests the spec declares for one language. */
export function readSources(root: string, lang: Lang, spec: Spec, validate: ValidateFunction<Sources>, extra: string[] = []): Sources {
  const language = spec.languages[lang];
  return readTree(root, lang, language.sources, language.tests, validate, [...extra, '--registry', spec.runners[lang].registry]);
}
