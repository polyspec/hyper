import { configDefaults, defineConfig } from 'vitest/config';

// A polyspec package is a link to its provider folder while the packages are 0.0.x (P30). Two rules give each such
// package one module instance, which its bound maps require (template VAL-22). Inlining the packages lets vitest load
// them through its own transform only, not once through Node as well. Keeping the link path as the module id
// (preserveSymlinks) stops vite from naming one file by its link path for one importer and by its real path for another.
// The generated tests of the Node and the WASM binding below native/ are node:test files, in which vitest finds no
// suite: `make test-node-addon` and `make test-wasm` run them, and this run excludes the directory (H35.9-10).
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { exclude: [...configDefaults.exclude, 'native/**'], server: { deps: { inline: [/@polyspec\//] } } },
});
