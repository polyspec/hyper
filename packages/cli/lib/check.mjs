// `hyper check` (HR-96): the manifest rules (HY-2) and the template rules (HY-48.3) of an application directory,
// without any output. `hyper build` runs the same checks before it writes anything. Both rules are those of the core
// of hyper (@polyspec/hyper/build), so the command tool and the servers apply one implementation.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { templateProblems } from '@polyspec/hyper/build';
import { listFiles } from './output-files.mjs';

/**
 * Returns the manifest of the application `app` and the problems of its templates with the number of templates; a
 * manifest that breaks HY-2 fails with the error of the manifest check of the core.
 */
export function checkApplication(app) {
  const bytes = readFileSync(join(app, 'app', 'app.json'));
  const templatesDir = join(app, 'templates');
  const templates = new Map();
  for (const file of listFiles(templatesDir).filter((name) => name.endsWith('.tpl')).sort()) {
    templates.set(relative(templatesDir, file).split(sep).join('/'), readFileSync(file, 'utf8'));
  }
  const problems = [...templateProblems(bytes, templates)];
  return { manifest: JSON.parse(bytes.toString('utf8')), problems, templates: templates.size };
}
