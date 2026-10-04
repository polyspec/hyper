// The template index of the asset build (HY-34). scripts/build-assets.mjs resolves this module to the index of the
// build that bundles the importing client, so the module has no file at run time.
import type { TemplateIndex } from './dist/index.js';

declare const index: TemplateIndex;
export default index;
