# Changelog

[한국어](CHANGELOG.ko.md).

## Unreleased

### Added

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
  - `make test-js`: 71 tests, including 51 router conformance cases, and the type check passed.
  - `make test-php`: 65 tests, including the same 51 router conformance cases, passed.
  - `make parity`: for eight compare steps, including a parameter route, a query string, a 422 response and titles and bodies with HTML special characters, the browser rendering of the document JSON equaled the PHP document byte for byte and every region part appeared in it. Three 404 steps returned 404.
  - `make bundle-size`: SSR script 28,930 gzip bytes, CSR shell 29,905 gzip bytes.
  - `make e2e`: the SSR flow, the CSR flow, the no-JavaScript flow and the comparison page passed.
