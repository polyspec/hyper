// Resolve installed native tools from package exports, preserving both linked sources and packed distributions (HR-70).
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = new URL(import.meta.resolve('@polyspec/kit/run-tests'));
const extension = extname(fileURLToPath(entry));
const root = dirname(createRequire(import.meta.url).resolve('@polyspec/kit/package.json'));
const directory = join('node_modules/@polyspec/kit', relative(root, dirname(fileURLToPath(entry))));

/** The repository-relative command path selected by the installed package. */
export const kitTool = (name: string): string => join(directory, `${name}${extension}`);

/** An installed native tool module beside the declared runner entry. */
export const kitModule = (name: string): URL => new URL(`./${name}${extension}`, entry);
