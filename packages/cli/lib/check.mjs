// `hyper check` (HR-96): the manifest rules (HY-2) and the template rules (HY-48.3) of an application directory,
// without any output. `hyper build` runs the same checks before it writes anything. Both rules are those of the Rust
// core, which the command tool calls through the Node binding of `@polyspec/hyper` (HR-61).
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { templateProblems } from '@polyspec/hyper/native';
import { listFiles } from './output-files.mjs';

/**
 * Returns the templates below `directory`, a map from the name of each `.tpl` file, its path below the directory with
 * `/`, to its source, in the byte order of the names.
 */
export function readTemplates(directory) {
  const names = listFiles(directory)
    .filter((file) => file.endsWith('.tpl'))
    .map((file) => relative(directory, file).split(sep).join('/'))
    .sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  return new Map(names.map((name) => [name, readFileSync(join(directory, name), 'utf8')]));
}

/**
 * Returns the manifest of the application `app`, the bytes of its file, its templates and the problems of its
 * templates with the number of templates; a manifest that breaks HY-2 fails with the error of the core.
 */
export function checkApplication(app) {
  const manifestBytes = readFileSync(join(app, 'app', 'app.json'));
  const templates = readTemplates(join(app, 'templates'));
  const problems = templateProblems(manifestBytes, templates);
  return { manifest: JSON.parse(manifestBytes.toString('utf8')), manifestBytes, templates: templates.size, sources: templates, problems: [...problems] };
}
