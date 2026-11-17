// Installs the plain release files that config/release-files.json pins (HR-80, docs/operations/dependencies.md) into
// var/release-files/<library>/<tag>/<path>. Each file is downloaded from its pinned URL, checked by its sha256 and
// published with one rename (HR-82); a file that is present with the pinned digest is not downloaded again. The script
// reads no files.json and no listing of a release (HR-89). Usage: node scripts/install-release-files.mts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';
import { jsonObject, jsonString, parseJsonObject } from './json.mts';

const CONFIG = 'config/release-files.json';
if (process.argv.length > 2) {
  process.stderr.write('Usage: node scripts/install-release-files.mts\n');
  process.exit(2);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const releases = jsonObject(parseJsonObject(readFileSync(CONFIG, 'utf8'), CONFIG).releases, `${CONFIG} releases`);
for (const [library, value] of Object.entries(releases)) {
  const release = jsonObject(value, `${CONFIG} ${library}`);
  const tag = jsonString(release.tag, `${CONFIG} ${library} tag`);
  for (const [path, entry] of Object.entries(jsonObject(release.files, `${CONFIG} ${library} files`))) {
    const file = jsonObject(entry, `${CONFIG} ${library} ${path}`);
    const url = jsonString(file.url, `${CONFIG} ${library} ${path} url`);
    const pinned = jsonString(file.sha256, `${CONFIG} ${library} ${path} sha256`);
    const target = join('var/release-files', library, tag, path);
    if (existsSync(target) && sha256(readFileSync(target)) === pinned) {
      process.stdout.write(`[install-release-files] ${target} is installed\n`);
      continue;
    }
    process.stdout.write(`[install-release-files] download ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const computed = sha256(bytes);
    if (computed !== pinned) throw new Error(`${url} has the sha256 ${computed}, and ${CONFIG} pins ${pinned}; nothing is written`);
    writeFileAtomic(target, bytes);
    process.stdout.write(`[install-release-files] ${target}\n`);
  }
}
