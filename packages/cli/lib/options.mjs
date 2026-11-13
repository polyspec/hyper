// The arguments of the subcommands of `hyper` (HR-96). Every option is read and checked here, before a subcommand
// reads an input or writes an output, so a wrong option writes nothing.
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

/** An error of the command line itself: an unknown subcommand, an unknown option or a missing option (exit 2). */
export class UsageError extends Error {}

// HYC-16.13: the name of an asset is a member of client/manifest.json and the stem of its file name.
const ASSET_NAME = /^[a-z][a-z0-9-]*$/;

/** Reads the options of one subcommand with parseArgs; an unknown option or a positional argument is a usage error. */
function read(args, options) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError(error.message, { cause: error });
  }
}

/** Fails with a usage error when one of `names` is missing. */
function required(values, names) {
  for (const name of names) if (values[name] === undefined || values[name] === '') throw new UsageError(`--${name} is required`);
}

/** The application directory of --app with its manifest and its templates, which every subcommand reads. */
function application(directory) {
  const app = resolve(directory);
  if (!existsSync(app) || !statSync(app).isDirectory()) throw new Error(`--app ${directory} is not a directory`);
  for (const path of [join('app', 'app.json'), 'templates']) {
    if (!existsSync(join(app, path))) throw new Error(`the application ${app} has no ${path}`);
  }
  return app;
}

/** The absolute path of `path`, relative to the application, which must lie inside it and name a file. */
function inside(app, path, option) {
  const normal = normalize(path);
  if (isAbsolute(path) || normal === '..' || normal.startsWith(`..${sep}`)) throw new Error(`${option} ${path} is not a path inside the application ${app}`);
  const file = resolve(app, normal);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${option} ${path} names no file of the application ${app}`);
  return file;
}

/** Splits `<left>=<right>` of an option, which has exactly one `=` and two parts that are not empty. */
function pair(value, option, form) {
  const parts = value.split('=');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') throw new Error(`${option} ${value} is not ${form}`);
  return parts;
}

/** The options of `hyper check --app <directory>`. */
export function checkOptions(args) {
  const values = read(args, { app: { type: 'string' } });
  required(values, ['app']);
  return { app: application(values.app) };
}

/**
 * The options of `hyper build`: the application, the output directory, the data base path of the static shell, the
 * assets of --asset and --tailwind by their names (HYC-16.13), the files of --static and the PHP namespace.
 */
export function buildOptions(args) {
  const values = read(args, {
    app: { type: 'string' },
    output: { type: 'string' },
    api: { type: 'string' },
    asset: { type: 'string', multiple: true },
    tailwind: { type: 'string', multiple: true },
    static: { type: 'string', multiple: true },
    'php-namespace': { type: 'string' },
  });
  required(values, ['app', 'output']);
  if (values.api === '') throw new Error('--api is empty');
  const app = application(values.app);
  const client = existsSync(join(app, 'client', 'main.ts'));
  // HR-96: the static shell inlines the client entry, so it exists only with client/main.ts and --api.
  if (values.api !== undefined && !client) throw new Error(`--api ${values.api} needs the client entry ${join(app, 'client', 'main.ts')}, which does not exist`);
  const shell = client && values.api !== undefined;
  const names = new Set();
  const named = (name, option) => {
    if (!ASSET_NAME.test(name) || name === 'hyper' || name.startsWith('hyper-')) {
      throw new Error(`${option}: the asset name ${name} does not match [a-z][a-z0-9-]* or is hyper or starts with hyper- (HYC-16.13)`);
    }
    if (names.has(name)) throw new Error(`${option}: the asset name ${name} is given twice (HYC-16.13)`);
    names.add(name);
    return name;
  };
  const assets = (values.asset ?? []).map((value) => {
    const [name, path] = pair(value, '--asset', '<name>=<path>');
    return { name: named(name, '--asset'), file: inside(app, path, '--asset') };
  });
  const tailwind = (values.tailwind ?? []).map((value) => {
    const [source, name] = pair(value, '--tailwind', '<source>=<name>');
    return { name: named(name, '--tailwind'), file: inside(app, source, '--tailwind') };
  });
  const statics = (values.static ?? []).map((path) => {
    if (!shell) throw new Error(`--static ${path} needs the static shell, which the build writes only with client/main.ts and --api`);
    if (!normalize(path).startsWith(`public${sep}`)) throw new Error(`--static ${path} is not below public/ of ${app}`);
    return { path: normalize(path).slice('public/'.length).split(sep).join('/'), file: inside(app, path, '--static') };
  });
  if (values['php-namespace'] === '') throw new Error('--php-namespace is empty');
  return { app, output: resolve(values.output), client, api: shell ? values.api : undefined, assets, tailwind, statics, phpNamespace: values['php-namespace'] };
}
