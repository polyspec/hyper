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
| `make templates-check` | Checks that only the layout template carries `hx-` attributes (HC-6) and that the layout places `{# title}`, `{# data}` and every manifest region once (HY-3) |
| `make parity` | Compares PHP documents with browser renders of document and region JSON |
| `make bundle-size` | Prints the SSR script and CSR shell sizes and enforces the gzip limits in `config/bundle-size.json` |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium |
| `make docs-check` | Checks document pairs, links and code blocks |
| `make serve-demo` | Serves SSR, CSR and the comparison page (see [Deployment](deployment.md)) |
| `make check` | Runs every check above |

## Asset build

`scripts/build-assets.mjs --app <directory> --api <base path>` writes:

1. `public/assets/templates/<name>.<hash>.json`: one AST file per template under `templates/`, and one for the reserved template `hyper/data.tpl` (HY-34).
2. `build/templates.index.json`: each template name with its file URL and the templates that its include and block tags reference by path.
3. `public/assets/hyper-<hash>.js` and `public/assets/manifest.json`: the client bundle and the URLs that the server passes to the layout. The bundle contains htmx, the hyper browser code, the template render runtime, `app/app.json` and the index, and no template.
4. `dist/csr/`: the CSR deployment. `index.html` contains `<meta name="hyper-api">`, the stylesheet and the bundle inlined; `assets/templates/` contains the template files. The build fails when the bundle contains `</script`, and it prints the Content Security Policy hashes of the inlined script and stylesheet.

The build replaces earlier outputs, so repeated builds leave one file per output. The outputs are not committed.

## Proof that PHP and the browser behave the same

| Behavior | Evidence |
|---|---|
| Kept values | `conformance/keep.json` runs in `make test-php` and `make test-js` (HY-38). |
| Routing | `conformance/routes.json` runs in `make test-php` and `make test-js`. During rendering, the browser also requires that its route equals the route that the server reported (HY-20). |
| Document rendering | `make parity` requests every compare step as an HTML document, as document JSON and as region JSON in one session. The browser rendering of the document JSON, including route regions, the embedded data and `server` and `cookie` kept values (HY-30, HY-31, HY-38), must equal the PHP document byte for byte, and every part of the region JSON must appear in it. |
| Behavior in a browser | `make e2e` runs the same flows on SSR and CSR: navigation, actions, `hy-set` changes without a data request, the four kept kinds across a reload and a new tab, loading only the templates of a route, and the comparison page that requires equal SSR and CSR bodies. |

## Measured sizes

Measured on 2026-10-01 with `make bundle-size` (htmx 4.0.0, esbuild 0.28.2, ten board templates and `hyper/data.tpl`):

| Output | Raw bytes | gzip bytes | brotli bytes |
|---|---:|---:|---:|
| SSR script `hyper-<hash>.js` | 88,447 | 29,619 | 26,637 |
| CSR shell `dist/csr/index.html` | 91,727 | 30,755 | 27,456 |
| Largest template file (`board/rows.tpl`) | 5,569 | 1,325 | 1,077 |
| All eleven template files | | 5,655 | |

A route loads only its own templates (HY-35), and a template file is cached by its hashed name. The AST of a template is about twice the size of its source after compression, because every node records its source span. `config/bundle-size.json` limits a template file to 4,096 gzip bytes, so a template that grows past it is split into blocks.
