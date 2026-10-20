import { defineConfig } from 'vitest/config';

// A polyspec package is a link to its provider folder while the packages are 0.0.x (P30). vitest run with this folder as
// its root would load such a package once through Node and once through its own transform, which are two instances of
// the template with two registries of bound maps; inlining the packages loads each of them once.
export default defineConfig({ test: { server: { deps: { inline: [/@polyspec\//] } } } });
