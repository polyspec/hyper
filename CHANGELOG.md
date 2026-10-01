# Changelog

[한국어](CHANGELOG.ko.md).

## Unreleased

### Added

- Keep region data across reloads (HY-37 to HY-41). A region declares kept paths with their storage: `server` (the server session, saved by a background request that rendering does not wait for), `cookie` (the `hy-keep` cookie written by the browser code), `localStorage` or `sessionStorage`. The server applies `server` and `cookie` values before it renders, so the first SSR document shows them; the browser applies `localStorage` and `sessionStorage` values before it renders a response, and after loading for a server document. A kept value replaces the loader value only at an existing path of the same type; `conformance/keep.json` holds the cases that PHP and JavaScript both pass. The shared data now always contains `csrf`.
- Use all four kinds in the board example: closing the notice (`server`), sorting (`localStorage`), the compact list (`sessionStorage`) and large text on the post page (`cookie`).

- Control the screen with data (HY-29 to HY-36). A route declares route regions that its template places with `{# name}`; each has its own loader. The layout embeds the document JSON with `{# data}` through the reserved template `hyper/data.tpl`, so the first SSR page holds its data. The browser code provides `data`, `render` and `set`, and an element with `hy-set="path=value"` changes the data of its region and renders the region again without a request. There is no change tracking.
- Deliver templates per route (HY-34, HY-35). The asset build writes one hashed AST file per template and an index; the client bundle contains the index only. A region request loads the templates of its route at the same time as the data, and a redirect loads the templates of the final route.
- Add the notice and list route regions to the board example: closing the notice and sorting the list change region data without a request. Define HC-7 and limit a template file to 4,096 gzip bytes.

- Define the screen composition rules (HC-1 to HC-6) in `docs/spec/composition.md`: HTML and CSS for parts that differ only in content, blocks for parts that receive data, regions for parts that update independently, and `hx-*` attributes only in the layout. Add `make templates-check` for HC-6. Verified on 2026-10-01: `make templates-check` passed on the seven board templates and failed on a page template with an added `hx-get` attribute.
- Define the region protocol (HY-1 to HY-28) in `docs/spec/protocol.md`: the application manifest, routing, rendering, requests, JSON responses, the browser code, actions and errors.
- Declare the board layout, title, regions and routes in one manifest, `examples/board/app/app.json`, that PHP and the browser read.
- Add the PHP router and the browser router, and `conformance/routes.json`, the router cases that both pass.
- Add `@polyspec/hyper`, the browser code: the htmx 4 extension that requests JSON for targets marked `hy-region`, routes the response URL, requires the server route to equal the browser route and renders regions; document rendering; and client-side rendering from a static shell with a base path.
- Add `polyspec/hyper`, the PHP server: documents, document JSON, region JSON, 303 redirects for successful actions, 422 pages for rejected input, region selection by changed topics, a base path, and 404 for missing resources.
- Add the board example with list, detail and create pages, server validation, a no-JavaScript fallback, a single-file CSR shell, an edge server that reproduces the CDN behavior, and a comparison page that shows SSR and CSR in two frames.
- Add the asset build, the parity check, the bundle size check, the document check, the deployment document and the end-to-end tests.

### Verification

- 2026-10-01, macOS, Node.js 26.8.1, PHP 8.5.10, Chromium from Playwright 1.63.0: `make check` passed.
  - `make test-js`: 94 tests, including 51 router and 17 kept value conformance cases, and the type check passed.
  - `make test-php`: 90 tests, including the same 51 router and 17 kept value conformance cases, passed.
  - `make parity`: for ten compare steps, including route regions, the embedded data, `server` and `cookie` kept values, a parameter route, a query string, a 422 response and titles and bodies with HTML special characters, the browser rendering of the document JSON equaled the PHP document byte for byte and every region part appeared in it. Three 404 steps returned 404.
  - `make bundle-size`: SSR script 29,619 gzip bytes, CSR shell 30,755 gzip bytes, largest template file 1,325 gzip bytes, eleven template files 5,655 gzip bytes in total.
  - `make e2e`: nine tests passed: the SSR and CSR flows, `hy-set` changes on SSR and CSR without a data request, the four kept kinds on SSR and CSR across a reload and a new tab, CSR loading only the templates of each route, the no-JavaScript flow and the comparison page.
