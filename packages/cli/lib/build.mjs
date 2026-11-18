// `hyper build` (HR-34, HR-96): one run builds every output of an application directory and computes its build id
// once (HY-125.15 to HY-125.21).
//   <app>/public/assets/templates/<name>.<hash>.json   one AST file per template, hyper/data.tpl included (HR-34)
//   <app>/public/assets/hyper-<hash>.js                 the client entry, when client/main.ts exists (HYC-16)
//   <app>/public/assets/hyper-chunk-<hash>.js           one chunk per code that the entry imports with import() only
//   <app>/public/assets/<name>.<hash>.<extension>       each asset of --asset and --tailwind (HR-77, HYC-16.12)
//   <output>/client/manifest.json                       the URL of the entry as hyper and of each asset by its name
//   <output>/client/assets.json                         {"files": [...]}: the paths public/assets/... of this build
//   <output>/client/assets.previous.json                the same form: the files of the last different build before it
//   <output>/client/templates.index.json                template name -> file URL, the index of the client bundle
//   <output>/client/csr/                                the static shell index.html with the copies of this build
//                                                       below assets/ and the --static files, with client/main.ts
//                                                       and --api (HY-62)
//   <output>/program/                                   the server program of lib/program.mjs with its build.json
//
// The checks of lib/options.mjs and lib/check.mjs and every input read pass before a file is written. The outputs are
// made in staging directories of this process; the id hashes them; then public/assets gains its files, and client/ and
// program/ are published file by file, the shell and build.json last, so a server never finds a file of its build
// missing (HR-82). After the publish a build whose list of files differs from that of the build before it removes
// below public/assets the files of the build two lists back, which client/assets.previous.json names and neither the
// list before nor its own list does, and reports each (HYC-16.17 to HYC-16.22). Below --output the build owns client/
// and program/ only.
//
// The template ASTs and the template render runtime of the bundle come from the template package `@polyspec/template`
// that this package depends on, whatever template package the application installed (HR-70).

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { build as bundle } from 'esbuild';
import { buildId, shellFile } from '@polyspec/hyper/build';
import { checkApplication } from './check.mjs';
import { copyFile, listFiles, writeFileAtomic } from './output-files.mjs';
import { PROGRAM_LAST, writeBuildFile, writeProgram } from './program.mjs';
import { publish, staging } from './publish.mjs';
import { sha256, templateFiles, templatePlugin } from './template-files.mjs';

/** Runs the build of `options` (lib/options.mjs) and returns the lines that it reports. */
export async function runBuild(options) {
  const { app, output } = options;
  const { manifest, problems } = checkApplication(app);
  if (problems.length > 0) throw new Error(problems.join('\n'));

  // Every file of public/assets that this build writes, by its name below public/assets, with its bytes.
  const assetFiles = [];
  const templates = await templateFiles({ templates: join(app, 'templates'), urlPrefix: '/assets/templates' });
  for (const file of templates.files) assetFiles.push({ name: `templates/${file.name}`, bytes: file.bytes });

  // HYC-16.12: an asset keeps its bytes and its extension below a name that holds its name and a hash of its content.
  const manifestUrls = {};
  const assets = [];
  for (const { name, file } of options.assets) assets.push({ name, bytes: readFileSync(file), extension: extname(file) });
  for (const { name, file } of options.tailwind) assets.push({ name, bytes: Buffer.from(await tailwind(app, readFileSync(file, 'utf8')), 'utf8'), extension: '.css' });
  for (const asset of assets) {
    const name = `${asset.name}.${sha256(asset.bytes).slice(0, 12)}${asset.extension}`;
    assetFiles.push({ name, bytes: asset.bytes });
    manifestUrls[asset.name] = `/assets/${name}`;
  }

  let entry;
  const chunks = [];
  if (options.client) {
    const result = await bundle({
      entryPoints: [join(app, 'client', 'main.ts')],
      bundle: true,
      splitting: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outdir: join(app, 'public', 'assets'),
      publicPath: '/assets',
      entryNames: 'hyper-[hash]',
      chunkNames: 'hyper-chunk-[hash]',
      write: false,
      logLevel: 'error',
      plugins: [templatePlugin(), indexPlugin(templates.index)],
    });
    const scripts = result.outputFiles.map((file) => ({ name: basename(file.path), bytes: Buffer.from(file.contents) }));
    const entries = scripts.filter((script) => !script.name.startsWith('hyper-chunk-'));
    if (entries.length !== 1) throw new Error(`the client build wrote ${entries.length} entry files`);
    entry = { name: entries[0].name, url: `/assets/${entries[0].name}`, code: entries[0].bytes.toString('utf8') };
    for (const script of scripts) {
      assetFiles.push(script);
      if (script.name !== entry.name) chunks.push(script.name);
    }
  }

  const clientTarget = join(output, 'client');
  const programTarget = join(output, 'program');
  // HYC-16.17: the list of the build before this one and the list of the last different build before that, both read
  // before this build writes a file (HYC-16.22).
  const earlierFile = join(clientTarget, 'assets.previous.json');
  const before = assetList(join(clientTarget, 'assets.json'));
  const earlier = assetList(earlierFile);
  const clientNext = staging(clientTarget);
  const programNext = staging(programTarget);
  rmSync(clientNext, { recursive: true, force: true });
  rmSync(programNext, { recursive: true, force: true });
  try {
    const count = writeProgram({ manifest, templates: join(app, 'templates'), directory: programNext });
    const manifestText = `${JSON.stringify({ ...(entry === undefined ? {} : { hyper: entry.url }), ...sortedObject(manifestUrls) }, null, 2)}\n`;
    const assetPaths = assetFiles.map((file) => `public/assets/${file.name}`).sort(compareBytes);
    const listText = (files) => `${JSON.stringify({ files }, null, 2)}\n`;
    const assetsText = listText(assetPaths);
    const indexText = `${JSON.stringify(templates.index, null, 2)}\n`;
    // HYC-16.19: a build that writes the files of the build before it moves no list and removes nothing, so builds of
    // unchanged sources do not make the files of the last different build removable any earlier.
    const unchanged = before.length === assetPaths.length && assetPaths.every((path) => before.includes(path));
    // HYC-16.21: every path that the two earlier lists and this list name. While this build runs, the published
    // assets.previous.json holds it, so the lists of a build that ends early name every file that exists below
    // public/assets by a build, and a later build removes what none of its two lists keeps.
    const everyPath = unchanged ? earlier : [...new Set([...earlier, ...before, ...assetPaths])].sort(compareBytes);
    writeFileAtomic(join(clientNext, 'manifest.json'), manifestText);
    writeFileAtomic(join(clientNext, 'assets.json'), assetsText);
    writeFileAtomic(join(clientNext, 'assets.previous.json'), listText(everyPath));
    writeFileAtomic(join(clientNext, 'templates.index.json'), indexText);

    // HY-125.15 to HY-125.17: the files that this build writes and that do not hold the id, by the paths of their places.
    const hashed = [
      ...assetFiles.map((file) => ({ path: `public/assets/${file.name}`, bytes: file.bytes })),
      ...['manifest.json', 'assets.json', 'templates.index.json'].map((name) => ({ path: `client/${name}`, bytes: readFileSync(join(clientNext, name)) })),
      ...options.statics.map(({ path, file }) => ({ path: `csr/${path}`, bytes: readFileSync(file) })),
      ...listFiles(programNext).map((file) => ({ path: `program/${file.slice(programNext.length + 1).split('\\').join('/')}`, bytes: readFileSync(file) })),
    ];
    const id = buildId(hashed);

    let shellBytes = 0;
    if (options.api !== undefined && entry !== undefined) {
      const shell = shellFile(options.api, id, entry.url, entry.code);
      shellBytes = Buffer.byteLength(shell);
      writeFileAtomic(join(clientNext, 'csr', 'index.html'), shell);
      // The copies hold the files of this build only; public/assets also holds the files that the application placed
      // there (HYC-16.14).
      for (const file of assetFiles) {
        if (file.name !== entry.name) writeFileAtomic(join(clientNext, 'csr', 'assets', file.name), file.bytes);
      }
      for (const { path, file } of options.statics) copyFile(file, join(clientNext, 'csr', path));
    }
    // HY-125.23: the id is written into build.json of program/ only, where every server reads it.
    writeBuildFile(programNext, id);

    // The order of a build whose list differs (HYC-16.21): first the list of every path into the published
    // assets.previous.json, then the files below public/assets, then client/ and program/, then the removal, then the
    // list of the build before into assets.previous.json. A build that ends at any point leaves lists that name every
    // file that a build wrote, so no file stays without a list, and a file is removed only after the outputs that no
    // longer name it are published, so no published list or page names a missing file.
    if (!unchanged) writeFileAtomic(earlierFile, listText(everyPath));
    for (const file of assetFiles) writeFileAtomic(join(app, 'public', 'assets', file.name), file.bytes);
    publish(clientNext, clientTarget, { last: [join('csr', 'index.html')] });
    publish(programNext, programTarget, { last: PROGRAM_LAST });

    // HYC-16.18: the files that assets.previous.json named and that neither the list of the build before nor the list
    // of this build names. The files of the build before stay, for its pages that are still open.
    const removed = [];
    for (const path of unchanged ? [] : earlier) {
      if (before.includes(path) || assetPaths.includes(path) || !existsSync(join(app, path))) continue;
      rmSync(join(app, path));
      removed.push(path);
    }
    if (!unchanged) writeFileAtomic(earlierFile, listText(before));

    const lines = [`build ${id}: ${count} templates, ${assetFiles.length} files below ${join(app, 'public', 'assets')}, ${clientTarget}, ${programTarget}`];
    for (const path of removed) lines.push(`removed ${path}`);
    if (entry !== undefined) lines.push(`entry ${entry.url}, ${chunks.length} chunks`);
    if (shellBytes > 0) {
      lines.push(`shell ${join(clientTarget, 'csr', 'index.html')} ${shellBytes} bytes`);
      lines.push(`CSP for ${join(clientTarget, 'csr', 'index.html')}: script-src 'self' 'sha256-${sha256(entry.code, 'base64')}'; style-src 'self'`);
    }
    return lines;
  } finally {
    rmSync(clientNext, { recursive: true, force: true });
    rmSync(programNext, { recursive: true, force: true });
  }
}

/**
 * The paths that a list of an earlier build names, `client/assets.json` or `client/assets.previous.json` (HYC-16.17),
 * or none for an output directory without that file. Each path is one that a build writes: below `public/assets/`,
 * without an empty, `.` or `..` segment. A file of another form fails the build before it writes (HYC-16.22), because
 * the build removes files that these lists name; the error names the file, what it refuses and the repair.
 */
function assetList(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const refused = (what) =>
    new Error(`${file} of an earlier build ${what}; the build removes files that this list names, so remove or correct ${file} and build again`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw refused('is not JSON text');
  }
  const files = typeof parsed === 'object' && parsed !== null ? parsed.files : undefined;
  if (!Array.isArray(files)) throw refused('holds no list `files`');
  for (const path of files) {
    const rest = typeof path === 'string' && path.startsWith('public/assets/') ? path.slice('public/assets/'.length) : '';
    if (rest === '' || rest.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw refused(`names ${JSON.stringify(path)}, which is no path of a file below public/assets`);
    }
  }
  return files;
}

/** Compares two strings by the bytes of their UTF-8 text, the order of HY-125.3. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sortedObject(object) {
  return Object.fromEntries(Object.keys(object).sort(compareBytes).map((key) => [key, object[key]]));
}

// The esbuild plugin that resolves @polyspec/hyper-client/templates-index to the template index of this build (HR-34).
function indexPlugin(templateIndex) {
  return {
    name: 'templates-index',
    setup(builder) {
      builder.onResolve({ filter: /^@polyspec\/hyper-client\/templates-index$/ }, () => ({ path: 'templates-index', namespace: 'templates-index' }));
      builder.onLoad({ filter: /.*/, namespace: 'templates-index' }, () => ({ contents: JSON.stringify(templateIndex), loader: 'json' }));
    },
  };
}

// Compiles the rules of an application stylesheet with the theme and the utilities of Tailwind CSS that the
// templates and the client code use; the rules lie in the layer components and no rule of the layer base exists
// (HR-77). Tailwind CSS resolves from the dependencies of this package.
async function tailwind(app, rules) {
  const sources = [`@source "${resolve(app, 'templates')}";`];
  if (existsSync(join(app, 'client'))) sources.push(`@source "${resolve(app, 'client')}";`);
  const input = [
    '@layer theme, base, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    ...sources,
    `@layer components {\n${rules.trimEnd()}\n}`,
  ].join('\n');
  const compiler = await compile(input, { base: dirname(dirname(fileURLToPath(import.meta.url))), onDependency: () => {} });
  const candidates = new Scanner({ sources: compiler.sources }).scan();
  return compiler.build(candidates);
}
