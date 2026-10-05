// The declared copy of the template repository (HY-78), which `make test-scripts` names in TEMPLATE_DIR.
import { resolve } from 'node:path';

const value = process.env.TEMPLATE_DIR;
if (value === undefined || value === '') throw new Error('TEMPLATE_DIR is required; run the tests with make test-scripts');

/** The absolute path of the declared copy of the template repository. */
export const templateDir = resolve(value);
