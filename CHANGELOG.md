# Changelog

[한국어](CHANGELOG.ko.md).

## Unreleased

### Fixed

The following defects of correctness and security are fixed. Each one has a test that failed before the fix.

- PHP server:
  - An unhandled exception printed the message, file paths and the stack trace, and one stored invalid UTF-8 byte broke the list for every visitor. The server now rejects input that is not UTF-8 with 400 (HY-42) and answers other failures with a plain 500 (HY-43).
  - `parse_url` read `/board/12:30` as `/` and `//board/1` as a host. The request path is now the request target before `?` or `#` (HY-42).
  - A POST with a non-page `Hy-Region` ran its action. The check now runs before loaders and actions (HY-16).
  - JSON carried integers outside the template data model with status 200. Both documents and JSON now fail with 500 (HY-44).
  - The session cookie had no `HttpOnly`, `SameSite` or `Secure`, and the server accepted identifiers that it did not create (HY-45).
  - Redirect locations such as `/\evil.example` were accepted (HY-46). `/_hyper/keep` stored values of any size; values longer than 4,096 bytes are now rejected (HY-40).
  - Empty kept maps and `stdClass` maps were not applied, and array spreading renumbered numeric data keys.
- Browser code:
  - After an SSR history restore, the browser kept the data of the earlier page; it now reads `#hy-data` of the restored document (HY-32).
  - Overlapping CSR restorations could mount the wrong page; only the latest one is rendered (HY-23).
  - CSR embedded browser kept values in `#hy-data`; the embedded data and JSON now stay server data, and browser values are applied only to held data. A `server` value whose saving has not completed now takes precedence over responses (HY-38, HY-39).
  - `set` added missing map keys (HY-33). A change through a parent or child of a kept path did not store it (HY-39). Region requests under a base path whose path already started with the base path were not prefixed (HY-23). `hy-set` rejected a string that ends with a backslash (HY-36).
  - A region request that received a non-JSON response swapped the body as HTML; it now does not swap and marks the region with `hy-error` (HY-47).
  - The client bundle contained the source of `hyper/data.tpl`; it now contains only the name (HY-34). Template references were computed by untested build code; `templateReferences` now lives in the package with tests.
- Example and development tools:
  - The comparison page ran `javascript:` URLs from `?ssr=` and accepted messages from any origin. Frames sent their whole body, including the CSRF token, to any parent. Frames now send a SHA-256 of the body to the embedding origin only, and the page accepts only http(s) origins.
  - The edge server cached `index.html` for a year; only files under `/assets/` are cached now.
- More defects of restorations, saves, request checks and failure marks are fixed with tests: a slow CSR restoration overwrote a later navigation (HY-23); a failed server save dropped its pending value, and a successful one could clear a later change (HY-39); one unrelated non-UTF-8 cookie blocked every page, so HY-42 now checks only `hy-keep` and the session cookie; `render`, `set` and `hy-set` changed held data before rendering and left failures unmarked (HY-47); kept values outside the data model caused lasting 500s and are now ignored or rejected (HY-38, HY-40); the request path of `?/x` and of absolute-form targets was wrong (HY-42); marks on regions outside the page region were not cleared, and cancelled requests were marked (HY-47); absolute and relative same-origin URLs were not prefixed (HY-23); redirect locations allowed C1 controls and invalid UTF-8 (HY-46); the session cookie could not be `Secure` behind a TLS-terminating CDN, and no response limited framing (HY-45). The example and the scripts start PHP with `display_errors=0`, because PHP prints startup warnings before the application runs (HY-43).
- `make templates-check` also checks that the layout places `{# title}`, `{# data}` and every manifest region once (HY-3), and manifests reject invalid topic names.

### Changed

- The recommended deployment serves direct requests with SSR and htmx requests with JSON from one server; the static shell is for backends that serve JSON only (`docs/operations/deployment.md`).

### Added

- Measure performance with `make bench` (`docs/operations/benchmark.md`). `make bench-server` times `App::handle` per request kind and the rendering, data model and JSON costs for 10 to 1,000 rows. `make bench-browser` measures first screens, region navigation, one `hy-set` change by phase (hyper, template engine, parsing, htmx morph, `htmx.process`) with its main thread load and the parts of every task over 50 ms, memory over 200 navigation cycles with the objects that grew between two heap snapshots and their retainers, and the `blink::MediaQuerySet` objects that Chromium keeps for inserted `<thead>` elements. On 2026-10-01 a `hy-set` change of 1,000 rows took 22 to 25 ms, of which the htmx morph took 13 to 15 ms and the template engine 3 ms; DOM nodes and event listeners stayed constant over 200 cycles.
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
