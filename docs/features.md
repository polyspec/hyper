# Feature status

[한국어](features.ko.md).

| ID | Feature | Status | Evidence |
|---|---|---|---|
| protocol | Region protocol specification (HY-1 to HY-66) | implemented | [Protocol](spec/protocol.md) |
| composition | Screen composition rules (HC-1 to HC-7) and the template check for HC-6 | implemented | [Composition](spec/composition.md), `make templates-check` |
| manifest | Application manifest read by PHP and the browser | implemented | `make test-php`, `make test-js` |
| router | PHP and browser routers with shared conformance cases | implemented | `make test-php`, `make test-js` |
| rest-routes | Rest parameters `{name*}` at the end of route paths (HY-49) | implemented | `make test-php`, `make test-js` |
| stop-results | Redirect and forbidden results of loaders and actions (HY-50, HY-51) | implemented | `make test-php` |
| page-statuses | Bad request stops of loaders and actions, and action results that render the page with 200, 409 or 422 (HY-58) | implemented | `make test-php`, `make test-node` |
| body-checks | Body limit and accepted form types of the application, checked as 413, 415 and then the CSRF 403 (HY-59) | implemented | `make test-php`, `make test-node`, `make server-parity` |
| failure-cache | `Cache-Control: no-store` on every response with a status of 400 or more (HY-65) | implemented | `make test-php`, `make test-node` |
| response-limit | Response limit of the application: a larger body is not sent and the request receives a plain 500 (HY-66) | implemented | `make test-php`, `make test-node` |
| response-hook | A response hook called once for every response with the request, the response, the elapsed time and the reply of the request with its notes (HY-60) | implemented | `make test-php`, `make test-node` |
| client-shell | One server answers client-rendered pages with the static shell and JSON under a data base path, and server-rendered pages without it, by a selection of each request; the browser gives the `html` element the attributes of the rendered layout (HY-62, HY-63) | implemented | `make test-php`, `make test-node`, `make test-js`, `make e2e` |
| stylesheet-links | The browser applies the stylesheet links of the head of a client-rendered document, of the layout of a region response and of a history restoration document: it keeps present links, loads missing links before it shows the content and then removes the others (HY-64) | implemented | `make test-js`, `make e2e` |
| reply | Response cookies and cache control of loaders and actions, and JSON tags with 304 (HY-52, HY-53) | implemented | `make test-php` |
| hyper-js | Browser code: region and document rendering, htmx extension, client-side rendering | implemented | `make test-js`, `make e2e` |
| hyper-php | PHP server: routes, actions, CSRF, flash, changed topics, base path, documents and JSON | implemented | `make test-php` |
| hyper-node | Node.js server `@polyspec/hyper-server` with the rules of the PHP server, file sessions, JSON with the bytes of PHP and the board example server (HY-54) | implemented | `make test-node`, `make node-server` |
| route-regions | Route regions inside a page with their own loaders (HY-30) | implemented | `make test-php`, `make parity` |
| region-data | Embedded document data, `data`, `render`, `set` and `hy-set` without requests (HY-29 to HY-33, HY-36) | implemented | `make test-js`, `make e2e` |
| kept-data | Kept paths in the server session, a cookie, localStorage and sessionStorage (HY-37 to HY-41) | implemented | `make test-php`, `make test-js`, `make parity`, `make e2e` |
| template-delivery | One file per template, loaded per route (HY-34, HY-35) | implemented | `make test-js`, `make e2e`, `make bundle-size` |
| parity | Browser documents and regions equal PHP documents byte for byte | implemented | `make parity` |
| server-parity | Node server responses equal PHP responses in status, headers and body for every parity step (HY-55) | implemented | `make server-parity` |
| ssr | Server-side rendering with JSON navigation and a no-JavaScript fallback | implemented | `make e2e` |
| csr | Client-side rendering from one static `index.html` and `/api` JSON | implemented | `make e2e` |
| comparison | Comparison page with SSR and CSR frames | implemented | `make e2e` |
| bundle-size | SSR script, CSR shell and template file size limits | implemented | `make bundle-size` |
| npm-packages | `@polyspec/hyper` and `@polyspec/hyper-server` publish JavaScript with type declarations that Node runs from `node_modules`, and their source passes `erasableSyntaxOnly` (HY-61) | implemented | `make package-check` |
| query-values | Every query value in order without nesting, and the raw query (HY-56) | implemented | `make test-php`, `make test-node` |
| form-values | Every form value of an urlencoded or multipart body in order without nesting (HY-57) | implemented | `make test-php`, `make test-node` |
| request-boundary | UTF-8 checks, plain 500 errors, data model checks, hardened session cookie, redirect checks, failure marks (HY-42 to HY-47) | implemented | `make test-php`, `make test-js`, `make e2e` |
| benchmark | Server and browser performance measurement: request cost, rendering per row count, first screens, `hy-set` main thread load and memory over navigation | implemented | `make bench`, [Benchmark](operations/benchmark.md) |
| server-program | PHP rendering with the native template extension, or with the generated PHP program of the same templates (HY-48) | implemented | `make test-php`, `make parity` |
| cdn-deployment | Server and CDN deployment (recommended) and static shell deployment | documented, not deployed | [Deployment](operations/deployment.md) |
| other-servers | Server packages for languages other than PHP and Node.js | not started | |
| publication | Registry publication of the packages | not started | |
