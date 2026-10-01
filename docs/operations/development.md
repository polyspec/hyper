# Development

[한국어](development.ko.md).

## Toolchain

- Node.js 26.8.1 (`.node-version`), PHP 8.2 or later with `pdo_sqlite`, Composer 2.
- The template repository at `../template`. `make template` builds its TypeScript package, which the browser code imports.
- Chromium for Playwright: `npx playwright install chromium`.

## Targets

| Target | Action |
|---|---|
| `make install` | Installs npm and Composer dependencies |
| `make template` | Builds the TypeScript template package |
| `make assets` | Builds the board client bundle and the CSR shell (see below) |
| `make test-js` | Runs the browser code tests, including the router conformance cases, and the type check |
| `make test-php` | Runs the server package tests, including the router conformance cases |
| `make lint` | Checks PHP formatting |
| `make parity` | Compares PHP documents with browser renders of document and region JSON |
| `make bundle-size` | Prints the SSR script and CSR shell sizes and enforces the gzip limits in `config/bundle-size.json` |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium |
| `make docs-check` | Checks document pairs, links and code blocks |
| `make serve-demo` | Serves SSR, CSR and the comparison page (see [Deployment](deployment.md)) |
| `make check` | Runs every check above |

## Asset build

`scripts/build-assets.mjs --app <directory> --api <base path>` bundles `client/main.ts` once. The bundle contains htmx, the hyper browser code, the template render runtime, `app/app.json` and every template AST. It writes:

1. `build/templates.ast.json`: every `.tpl` file under `templates/`, parsed into its AST and keyed by its name relative to `templates/`.
2. `public/assets/hyper-<hash>.js` and `public/assets/manifest.json`: the SSR script and the URLs that the server passes to the layout.
3. `dist/csr/index.html`: the CSR shell with `<meta name="hyper-api">`, the stylesheet and the bundle inlined. The build fails when the bundle contains `</script`, and it prints the Content Security Policy hashes of the inlined script and stylesheet.

The build replaces earlier outputs, so repeated builds leave one file per output. The outputs are not committed.

## Proof that PHP and the browser behave the same

| Behavior | Evidence |
|---|---|
| Routing | `conformance/routes.json` runs in `make test-php` and `make test-js`. During rendering, the browser also requires that its route equals the route that the server reported (HY-20). |
| Document rendering | `make parity` requests every compare step as an HTML document, as document JSON and as region JSON in one session. The browser rendering of the document JSON must equal the PHP document byte for byte, and every part of the region JSON must appear in it. |
| Behavior in a browser | `make e2e` runs the same flow on SSR and CSR, and the comparison page requires that the SSR body and the CSR body are equal after the first render and after navigation in both frames. |

## Measured sizes

Measured on 2026-10-01 with `make bundle-size` (htmx 4.0.0, esbuild 0.28.2, seven board templates):

| Output | Raw bytes | gzip bytes | brotli bytes |
|---|---:|---:|---:|
| SSR script `hyper-<hash>.js` | 88,319 | 28,930 | 25,835 |
| CSR shell `dist/csr/index.html` | 90,800 | 29,905 | 26,521 |

The AST of a template is about twice the size of its source after compression, because every node records its source span. The template parser adds about 8 KB (gzip). Shipping ASTs therefore stays smaller than shipping sources with the parser until the template sources reach about 8 KB (gzip).
