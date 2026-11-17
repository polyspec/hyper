import { configDefaults, defineConfig } from 'vitest/config';

// A polyspec package is a link to its provider folder while the packages are 0.0.x (P30). Two rules give each such
// package one module instance, which its bound maps require (template VAL-22). Inlining the packages lets vitest load
// them through its own transform only, not once through Node as well. Keeping the link path as the module id
// (preserveSymlinks) stops vite from naming one file by its link path for one importer and by its real path for another.
// The generated test of the WASM binding (native/wasm/generated/tests) is no test of this run: it imports the glue
// hyper_wasm.js, which make node-package writes and make hyper-test-node does not build, and make test-wasm runs it
// against the installed package (HR-85).
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { exclude: [...configDefaults.exclude, 'native/wasm/**'], server: { deps: { inline: [/@polyspec\//] } } },
});
