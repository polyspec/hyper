// `hyper check` (HR-96): the manifest rules (HY-2) and the template rules (HY-48.3) of an application directory,
// without any output. `hyper build` runs the same checks before it writes anything.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkManifest } from '@polyspec/hyper-client';
import { parse, resolvePath } from '@polyspec/template';
import { templateProblems } from './template-rules.mjs';

/**
 * Returns the manifest of the application `app` and the problems of its templates with the number of templates; a
 * manifest that breaks HY-2 fails with the message of the manifest check.
 */
export function checkApplication(app) {
  const manifest = JSON.parse(readFileSync(join(app, 'app', 'app.json'), 'utf8'));
  checkManifest(manifest);
  const { problems, templates } = templateProblems({ manifest, templatesDir: join(app, 'templates'), parse, resolvePath });
  return { manifest, problems, templates };
}
