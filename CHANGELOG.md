# Changelog

[한국어](CHANGELOG.ko.md).

## Unreleased

### Added

- A route path can end with a rest parameter `{name*}`, which matches zero or more remaining request segments and holds the rest of the request path without decoding (HY-49). Both routers pass the cases of `conformance/rest.json`.

### Fixed

- These defects of swaps, kept values, redirects and sessions are fixed with tests that failed before:
  - The fix of the call order (HY-33) ended a `set`, `render` or `hy-set` change on any response, even one that did not contain its region, after the swap had already changed the page. The page then showed a value that was neither held nor stored. A change now ends only when the data of its own region was replaced, before the swap; when that happens during the swap, the region renders again from held data (HY-33).
  - The browser passed route regions to the page region as template definitions, so a route region saw the page region data in region responses but not in documents; after HY-48 the PHP document and an htmx navigation to the same URL could differ. Server and browser now both render route regions alone and pass HTML (HY-12, HY-13). `make parity` did not cover this case; a test now does.
  - Browser kept values were applied in declaration order instead of the order of HY-38 (browser storage, then pending server values).
  - Client-side rendering decoded a document against the requested path instead of the URL after redirects (HY-22).
  - Every request started a session and wrote a session file, including requests rejected before routing and paths without a route (HY-45).
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
- More defects of the changes from "Keep region data in the server session, a cookie or Web Storage" to "Fix defects of kept data, requests and failures" are fixed with tests:
  - Two `set` calls at the same time lost one change. A change also stored the value of a response that arrived while it rendered, and swapped stale content over it. Calls now run in call order, and a change whose held data a response replaced ends without swapping, holding or storing (HY-33).
  - Saves of one path could arrive out of order, and an older failed save marked a region whose latest value was saved. Saves of a path are now sent one at a time with the latest value, and only the save of the latest change marks the region (HY-39).
  - A failure of `holdEmbedded` (template loading, rendering or unreadable embedded data) was not marked and rejected unhandled. It now marks the regions or the body and does not reject (HY-47).
  - A request that htmx aborted on its timeout was not marked. It is now a network failure (HY-47).
  - Kept maps and lists were checked only by their outer type, so a stored value with another inner shape caused 500 on every document. Kept values now conform to the shape of the data (HY-38). A conforming value that still breaks rendering makes its region render with its loader data (HY-38).
  - Query and form names nested in arrays skipped the UTF-8 check (HY-42).
  - Redirect locations accepted `.` and `..` segments, such as `/.//evil.example` (HY-46).
- `make templates-check` also checks that the layout places `{# title}`, `{# data}` and every manifest region once (HY-3), and manifests reject invalid topic names.

### Changed

- Remove the attribute `hy-region` and the request header `Hy-Region`, which repeated what the manifest already says. A POST with a non-page `Hy-Region` ran its action (fixed earlier by the rule HY-16, now removed), and an element with a region `id` but without the attribute made htmx put a whole HTML document into the region. A region element is now the element whose `id` is the region name (HY-3, HY-36); the extension requests JSON when the target is the page region element, and the server recognizes a region request by `HX-Request`, which htmx sends (HY-15, HY-21). `make templates-check` checks every region placement of the layout and of the route templates, and region placements take no block arguments.
- On HTTPS the kept cookie is `__Host-hy-keep`, so a sibling subdomain cannot set kept values (HY-39).
- Remove the Chromium `<thead>` measurement from `make bench-browser`; it measured a browser behavior, not this project.
- The PHP server renders with a program that `make server` compiles from the templates: the native template extension when PHP has loaded it, and otherwise the generated PHP program (HY-48). The PHP AST interpreter took 15.7 ms for 1,000 rows on an idle machine, and the generated program 9.6 ms on the same input, with identical output. The native extension was measured only on a heavily loaded machine, so its speed is not recorded here. The server renders every region alone and passes HTML definitions, because a generated program fixes the template of each definition. `make test-php` and `make parity` run with both programs. `App::open` takes `program:` in place of `templates:`, and `TemplateLoader` is removed.
- A JSON response carries kept values apart from the region data (HY-17). `regions` holds the loader data, and `kept` holds the conforming `server` and `cookie` values. The server applies them to render a document, and the browser applies them with its own values. The browser can therefore render a region without kept values that break it (HY-38).
- The server no longer checks cookies for UTF-8 (HY-42). It ignores an invalid `hy-keep`, and starts a new session for an invalid session cookie, instead of answering 400 to every request until the cookie expires.
- The recommended deployment serves direct requests with SSR and htmx requests with JSON from one server; the static shell is for backends that serve JSON only (`docs/operations/deployment.md`).

### Added

- Measure performance with `make bench` (`docs/operations/benchmark.md`). `make bench-server` times `App::handle` per request kind and the rendering, data model and JSON costs for 10 to 1,000 rows. `make bench-browser` measures first screens, region navigation, one `hy-set` change by phase (hyper, template engine, parsing, htmx morph, `htmx.process`) with its main thread load and the parts of every task over 50 ms, memory over 200 navigation cycles with the objects that grew between two heap snapshots and their retainers, and the `blink::MediaQuerySet` objects that Chromium keeps for inserted `<thead>` elements. On 2026-10-01 a `hy-set` change of 1,000 rows took 22 to 25 ms, of which the htmx morph took 13 to 15 ms and the template engine 3 ms; DOM nodes and event listeners stayed constant over 200 cycles.
- Keep region data across reloads (HY-37 to HY-41). A region declares kept paths with their storage: `server` (the server session, saved by a background request that rendering does not wait for), `cookie` (the `hy-keep` cookie written by the browser code), `localStorage` or `sessionStorage`. The server applies `server` and `cookie` values before it renders, so the first SSR document shows them; the browser applies `localStorage` and `sessionStorage` values before it renders a response, and after loading for a server document. A kept value replaces the loader value only at an existing path whose value has the same shape (HY-38); `conformance/keep.json` holds the cases that PHP and JavaScript both pass. The shared data now always contains `csrf`.
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

- 2026-10-01, after the removal of `hy-region` and `Hy-Region` and the fixes of swaps, kept values, redirects and sessions: `make check` passed. `make test-scripts` 2 tests, `make test-js` 145 tests, `make test-php` 149 tests with the generated program and 149 with the native extension (one test does not apply and is skipped), `make parity` with both programs, `make bundle-size` and `make e2e` 12 tests.
- 2026-10-01, after the change to compiled template programs (HY-48): `make check` passed.
  - `make test-php`: 148 tests passed with the generated program, and 148 with the native extension, where the test of loading a second generated program does not apply and is skipped.
  - `make parity`: the ten compare steps matched byte for byte with the generated program and with the native extension.
  - `make test-js` 139 tests, `make e2e` 12 tests and `make bundle-size` passed.
- 2026-10-01, after the fixes of the call order, the saves and the request checks, macOS, Node.js 26.8.1, PHP 8.5.10, Chromium from Playwright 1.63.0: `make check` passed.
  - `make test-js`: 139 tests, including 31 kept value conformance cases, and the type check passed.
  - `make test-php`: 145 tests, including the same 31 kept value conformance cases, passed.
  - `make parity`: the ten compare steps matched byte for byte, and the three 404 steps returned 404.
  - `make bundle-size`: SSR script 31,043 gzip bytes (limit 31,400), CSR shell 32,345 gzip bytes (limit 32,600), largest template file 1,325 gzip bytes.
  - `make e2e`: 12 tests passed.
- 2026-10-01, macOS, Node.js 26.8.1, PHP 8.5.10, Chromium from Playwright 1.63.0: `make check` passed.
  - `make test-js`: 94 tests, including 51 router and 17 kept value conformance cases, and the type check passed.
  - `make test-php`: 90 tests, including the same 51 router and 17 kept value conformance cases, passed.
  - `make parity`: for ten compare steps, including route regions, the embedded data, `server` and `cookie` kept values, a parameter route, a query string, a 422 response and titles and bodies with HTML special characters, the browser rendering of the document JSON equaled the PHP document byte for byte and every region part appeared in it. Three 404 steps returned 404.
  - `make bundle-size`: SSR script 29,619 gzip bytes, CSR shell 30,755 gzip bytes, largest template file 1,325 gzip bytes, eleven template files 5,655 gzip bytes in total.
  - `make e2e`: nine tests passed: the SSR and CSR flows, `hy-set` changes on SSR and CSR without a data request, the four kept kinds on SSR and CSR across a reload and a new tab, CSR loading only the templates of each route, the no-JavaScript flow and the comparison page.
