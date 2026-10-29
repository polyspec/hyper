// Resolve installed native tools from package exports, preserving both linked sources and packed distributions (HR-70).
import { realpathSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = new URL(import.meta.resolve('@polyspec/kit/run-tests'));
const extension = extname(fileURLToPath(entry));
// make runs every kit tool from the real path of the installed kit, the linked checkout or the packed copy (kit K762).
const directory = realpathSync(dirname(fileURLToPath(entry)));

/** The command path of a kit tool as make runs it. */
export const kitTool = (name: string): string => join(directory, `${name}${extension}`);

/** An installed native tool module beside the declared runner entry. */
export const kitModule = (name: string): URL => new URL(`./${name}${extension}`, entry);
