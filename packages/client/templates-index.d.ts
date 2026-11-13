// The template index of hyper build (HR-34). hyper build resolves this module to the index of the
// build that bundles the importing client, so the module has no file at run time.
import type { TemplateIndex } from './dist/index.js';

declare const index: TemplateIndex;
export default index;
