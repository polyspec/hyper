# Development

[한국어](development.ko.md).

## Toolchain

- Node.js 26.8.1 (`.node-version`), PHP 8.2 or later with `pdo_sqlite`, Composer 2.
- The template repository at `../template`. `make template` builds its TypeScript package, which the browser code imports.
- Rust (the version that the template repository pins) to build the native template extension with `make ext`.
- Chromium for Playwright: `npx playwright install chromium`.

## Targets

| Target | Action |
|---|---|
| `make install` | Installs npm and Composer dependencies |
| `make template` | Builds the TypeScript template package and reinstalls the Composer copies of the PHP template package; tests, assets and server builds run it first |
| `make template-check` | Fails when a Composer copy of the PHP template package differs from the template repository |
| `make ext` | Builds the native template extension of the template repository into `build/ext` (HY-48) |
| `make packages` | Builds the JavaScript modules and type declarations of `@polyspec/hyper` and `@polyspec/hyper-server` into their `dist` directories; the Node server tests, the board asset build and `make package-check` run it first, because they import the packages through their exports (HY-61). The build scripts read `data-template.json`, `checkManifest` and `templateReferences` from the source of `packages/hyper-js` next to them, so they do not need `dist` and run from any working directory |
| `make package-check` | Installs both packages into `tests/package-install` with `npm install --install-links`, type-checks its test against their declarations with `erasableSyntaxOnly` and runs it under `node` (HY-61) |
| `make server` | Builds the board server program into `examples/board/build/server` (see below) |
| `make server-fixtures` | Builds the server program of the PHP test fixtures |
| `make node-fixtures` | Builds the template files of the PHP test fixtures for the Node server tests with `scripts/build-templates.mjs` and the template repository `../template` (HY-70) |
| `make node-server` | Type-checks and bundles the board Node server into `examples/board/build/node/server.mjs` (see below) |
| `make assets` | Builds the board client bundle and the CSR shell (see below) |
| `make test-js` | Runs the browser code tests, including the router conformance cases, and the type check |
| `make test-node` | Runs the Node server tests: the cases of the PHP server tests against the same fixtures, the JSON cases of `conformance/json.json`, sessions, the HTTP server, and the type check |
| `make test-php` | Runs the server package tests, including the router conformance cases, once with the generated program and once with the native extension |
| `make lint` | Checks PHP formatting |
| `make analyse-php` | Runs PHPStan at level `max` on the source and the tests of `packages/hyper-php` with `packages/hyper-php/phpstan.neon`, without a baseline and without ignored errors. PHPStan reads the signatures of the native template extension from `../template/packages/template-php-ext/stubs/polyspec_template.stub.php` and writes its cache to `build/phpstan` |
| `make templates-check` | Checks that only the layout template carries `hx-` attributes (HC-6), that the layout places `{# title}` and `{# data}` once, and that every region of the layout and of each route template is placed once, directly inside an element whose `id` is the region name, without block arguments (HY-3, HY-30) |
| `make test-scripts` | Runs the tests of the check scripts, such as the region placement check with a broken fixture application |
| `make parity` | Compares PHP documents with browser renders of document and region JSON, once with the generated program and once with the native extension |
| `make server-parity` | Runs the parity steps against the PHP server and the board Node server and compares the status, the headers and the body of every response, with the browser comparison of `make parity` (HY-55) |
| `make bundle-size` | Prints the SSR script and CSR shell sizes and enforces the gzip limits in `config/bundle-size.json` |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium |
| `make docs-check` | Checks document pairs, links and code blocks |
| `make serve-demo` | Serves SSR, CSR and the comparison page (see [Deployment](deployment.md)) |
| `make bench-server-smoke` | Runs the PHP benchmark once per measurement; `make check` includes it so that a change that breaks the benchmark fails |
| `make bench` | Runs `make bench-server` and `make bench-browser`, which report server and browser performance (see [Benchmark](benchmark.md)); they are not part of `make check` |
| `make check` | Runs every check above |

## Server build

`scripts/build-server.mjs --manifest <app.json> --templates <directory> --output <directory> --template-dir <template repository> --php-namespace <namespace>` writes the server program (HY-48):

1. `templates/`: every template of the application and the reserved template `hyper/data.tpl`. The native extension reads these files.
2. `program.php`: the generated PHP program of the same templates, compiled with the compiler of the template repository into the given PHP namespace (`Polyspec\Hyper\Examples\Board\Program` for the board). `program.json` records the namespace, which the renderer reads. Every template renders as a target, and every definition is HTML, because the server renders each region alone.

PHP renders with the native extension when it has loaded `polyspec_template`, and otherwise with `program.php`. Both outputs are built from the same sources, so a server can switch by loading or not loading the extension.

## Node server

`make node-server` bundles `examples/board/node/main.ts` with esbuild into `examples/board/build/node/server.mjs`. The board Node server serves the same application as `examples/board/public/index.php`, with `node:sqlite` for the posts, and serves the files of `examples/board/public`:

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_SESSIONS` is an absolute session directory, and `BOARD_BASE_PATH`, `BOARD_HTTPS` and `BOARD_FRAME_ANCESTORS` have the meaning that they have for PHP. `BOARD_TIME`, for both servers, fixes the creation time of new posts in Unix seconds, so that `make server-parity` compares the same posts. The Node server renders with the template files of `make assets` (HY-54).

## Asset build

`scripts/build-assets.mjs --app <directory> --api <base path> --template-dir <template repository>` writes the following outputs with the template package of the template repository (HY-70):

1. `public/assets/templates/<name>.<hash>.json`: one AST file per template under `templates/`, and one for the reserved template `hyper/data.tpl` (HY-34).
2. `build/templates.index.json`: each template name with its file URL (HY-34).
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js` and `public/assets/manifest.json`: the client entry, one chunk file per code that the entry imports with `import()` only, which the browser loads when that code first runs, and the URL of the entry as `hyper`, which the server passes to the layout (HY-76). The entry contains htmx, the hyper browser code, the template render runtime, `app/app.json` and the index, and no template. The build writes no file that the application names; the application places and links its own stylesheets.
4. `dist/csr/`: the CSR deployment. `index.html` contains `<meta name="hyper-api">` and the entry inlined, and no stylesheet, because the browser applies the stylesheet links of the rendered layout (HY-64, HY-76); `assets/templates/` contains the template files, and `assets/` contains the chunk files and every `.css` file directly in `public/assets/`, which rendered layouts link. The build fails when the entry contains `</script`, and it prints the Content Security Policy with the hash of the inlined entry.

The build replaces earlier outputs, so repeated builds leave one file per output. The outputs are not committed.

## Proof that PHP, Node.js and the browser behave the same

| Behavior | Evidence |
|---|---|
| Kept values | `conformance/keep.json` runs in `make test-php` and `make test-js` (HY-38). |
| JSON text | `conformance/json.json` runs in `make test-php` and `make test-node`: the Node server writes the bytes of PHP `json_encode` and reads kept values as PHP `json_decode` does (HY-54). |
| Routing | `conformance/routes.json` runs in `make test-php` and `make test-js`. During rendering, the browser also requires that its route equals the route that the server reported (HY-20). |
| Document rendering | `make parity` requests every compare step as an HTML document, as document JSON and as region JSON in one session. The browser rendering of the document JSON, including route regions, the embedded data and `server` and `cookie` kept values (HY-30, HY-31, HY-38), must equal the PHP document byte for byte after the masked CSRF token of each response, which differs per response (HY-24), is replaced by `<csrf>`, and every part of the region JSON must appear in it. |
| Node server | `make server-parity` sends every request of the parity steps to the PHP server and the board Node server, each with its own database and session, and requires equal statuses, headers and bodies after it replaces the session identifier, the masked CSRF token of each response and the `ETag` value with placeholders (HY-55). |
| Behavior in a browser | `make e2e` runs the same flows on SSR and CSR: navigation, actions, `hy-set` changes without a data request, the four kept kinds across a reload and a new tab, loading only the templates of a route, the stylesheet links of the layout loaded before a page is shown and removed when another page does not link them (HY-64), and the comparison page that requires equal SSR and CSR bodies. |

## Measured sizes

Measured on 2026-10-04 with `make bundle-size` (htmx 4.0.0, esbuild 0.28.2, ten board templates and `hyper/data.tpl`):

| Output | Raw bytes | gzip bytes | brotli bytes | gzip limit |
|---|---:|---:|---:|---:|
| SSR script `hyper-<hash>.js` | 98,259 | 32,639 | 29,125 | 32,700 |
| CSR shell `dist/csr/index.html` | 98,498 | 32,782 | 29,220 | 33,200 |
| Largest template file (`board/rows.tpl`) | 5,583 | 1,334 | 1,084 | 4,096 |
| All eleven template files | | 5,818 | | |

The limits of the SSR script and the CSR shell in `config/bundle-size.json` are the measured gzip sizes plus about 1 %, rounded up to 100 bytes. A change that makes an output larger than its limit changes the limit in the same change and states why the growth is needed; a change that makes an output smaller lowers the limit by the same rule.

The browser loads only the templates that its rendering reaches (HY-35), and a template file is cached by its hashed name. The AST of a template is about twice the size of its source after compression, because every node records its source span. `config/bundle-size.json` limits a template file to 4,096 gzip bytes, so a template that grows past it is split into blocks.
