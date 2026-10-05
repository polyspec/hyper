# Feature status

[한국어](features.ko.md).

| ID | Feature | Status | Evidence |
|---|---|---|---|
| protocol | Region protocol specification (HY-1 to HY-80) | implemented | [Protocol](spec/protocol.md) |
| composition | Screen composition rules (HC-1 to HC-7) and the template check for HC-6 | implemented | [Composition](spec/composition.md), `make templates-check` |
| manifest | Application manifest read by PHP and the browser | implemented | `make test-php`, `make test-js` |
| router | PHP and browser routers with shared conformance cases | implemented | `make test-php`, `make test-js` |
| rest-routes | Rest parameters `{name*}` at the end of route paths (HY-49) | implemented | `make test-php`, `make test-js` |
| stop-results | Redirect and forbidden results of loaders and actions (HY-50, HY-51) | implemented | `make test-php` |
| page-statuses | Bad request stops of loaders and actions, and action results that render the page with 200, 409 or 422 (HY-58) | implemented | `make test-php`, `make test-node` |
| page-forbidden | A loader or an action gives the page of its request the status 403 through the reply, for a page that shows other data in place of the data that the request may not see (HY-69) | implemented | `make test-php`, `make test-node` |
| body-checks | Body limit and accepted form types of the application, checked as 413, 415 and then the CSRF 403 (HY-59) | implemented | `make test-php`, `make test-node`, `make server-parity` |
| failure-cache | `Cache-Control: no-store` on every response with a status of 400 or more (HY-65) | implemented | `make test-php`, `make test-node` |
| response-limit | Response limit of the application: a larger body is not sent and the request receives a plain 500 (HY-66) | implemented | `make test-php`, `make test-node` |
| disconnect-hook | A disconnect hook for a request whose client closed the connection: the Node server stops the request, and PHP ends the script at the first failed write (HY-67) | implemented | `make test-php`, `make test-node` |
| response-hook | A response hook called once for every response with the request, the response, the elapsed time and the reply of the request with its notes, and the failure of a 500 (HY-60) | implemented | `make test-php`, `make test-node` |
| client-shell | One server answers client-rendered pages with the static shell and JSON under a data base path, and server-rendered pages without it, by a selection of each request, whose value every handler of the request reads; the browser gives the `html` element the attributes of the rendered layout (HY-62, HY-63) | implemented | `make test-php`, `make test-node`, `make test-js`, `make e2e` |
| stylesheet-links | The browser applies the stylesheet links of the head of a client-rendered document, of the layout of a region response and of a history restoration document: it keeps present links, loads missing links before it shows the content and then removes the others (HY-64) | implemented | `make test-js`, `make e2e` |
| reply | Response cookies and cache control of loaders and actions, and JSON tags with 304 (HY-52, HY-53) | implemented | `make test-php` |
| csrf | A masked CSRF token in every response, the session cookie `__Host-hy-session` or `hy-session`, session renewal in an action and no shared cache of a page (HY-24, HY-45, HY-52, HY-53, HY-72) | implemented | `make test-php`, `make test-node`, `make server-parity` |
| read-paths | The read paths of every route computed from the template ASTs, written to `reads.json` for PHP and computed when the Node server opens; both servers send only those paths of the shared and region data (HY-44, HY-73) | implemented | `make test-js`, `make test-php`, `make test-node`, `make server-parity` |
| php-errors | A warning, notice or deprecation of a PHP request fails it with the plain 500 instead of a wrong page (HY-74) | implemented | `make test-php` |
| absent-route-regions | A route region loader that returns null makes the region absent from the response; a route region may be placed in a template that the route template includes or places; the browser checks the element of every route region (HY-30, HY-75) | implemented | `make test-js`, `make test-php`, `make test-node`, `make templates-check`, `make server-parity` |
| php-analysis | PHPStan at level `max` checks the source and the tests of the PHP server package, without a baseline or ignored errors | implemented | `make analyse-php` |
| hyper-js | Browser code: region and document rendering, htmx extension, client-side rendering | implemented | `make test-js`, `make e2e` |
| hyper-php | PHP server: routes, actions, CSRF, flash, changed topics, base path, documents and JSON | implemented | `make test-php` |
| hyper-node | Node.js server `@polyspec/hyper-server` with the rules of the PHP server, file sessions, JSON with the bytes of PHP and the board example server (HY-54) | implemented | `make test-node`, `make node-server` |
| route-regions | Route regions inside a page with their own loaders (HY-30) | implemented | `make test-php`, `make parity` |
| region-data | Embedded data of the route regions, `data`, `render`, `set` and `hy-set` on route regions without requests, and the public data rule (HY-29 to HY-33, HY-36, HY-71) | implemented | `make test-js`, `make e2e` |
| kept-data | Kept paths in the server session, a cookie, localStorage and sessionStorage (HY-37 to HY-41) | implemented | `make test-php`, `make test-js`, `make parity`, `make e2e` |
| template-delivery | One file per template, loaded when rendering reaches it (HY-34, HY-35) | implemented | `make test-js`, `make e2e`, `make bundle-size` |
| tailwind-build | `--tailwind <source>=<output>` compiles an application stylesheet with the Tailwind theme and the utilities that its templates use (HY-77) | implemented | `make test-scripts` |
| asset-delivery | A page requests only the resources that it uses: client chunks loaded by `import()`, a manifest with the entry URL only, a static shell without a stylesheet (HY-76) | implemented | `make test-scripts`, `make e2e` |
| parity | Browser documents and regions equal PHP documents byte for byte | implemented | `make parity` |
| server-parity | Node server responses equal PHP responses in status, headers and body for every parity step (HY-55) | implemented | `make server-parity` |
| ssr | Server-side rendering with JSON navigation and a no-JavaScript fallback | implemented | `make e2e` |
| csr | Client-side rendering from one static `index.html` and `/api` JSON | implemented | `make e2e` |
| comparison | Comparison page with SSR and CSR frames | implemented | `make e2e` |
| bundle-size | SSR script, CSR shell and template file size limits | implemented | `make bundle-size` |
| npm-packages | `@polyspec/hyper` and `@polyspec/hyper-server` publish JavaScript with type declarations that Node runs from `node_modules`, and their source passes `erasableSyntaxOnly` (HY-61) | implemented | `make package-check` |
| output-files | The asset build and the server build create their copied output files with the mode 0644, which a virtiofs bind mount of a Linux container accepts (HY-68) | implemented | `make test-scripts` |
| template-dir | The asset build, the template build and the server build read the template package of the template repository that `--template-dir` names (HY-70) | implemented | `make test-scripts` |
| template-copy | npm, Composer, PHPStan, the native extension build and the build scripts read the template repository only through its declared copy `var/products/template` (HY-78) | implemented | `make test-scripts`, `make template-check` |
| template-branch | The declared copy is the commit at the head of the template branch that `config/template.json` names; a missing branch, a build of other inputs or a changed input fails the copy with the expected and the actual value, `make template` copies only when `config/template.json` changes, and the full-run record names the branch (HY-80) | implemented; full run pending | `tests/scripts/template-copy.test.mjs`, `tests/scripts/full-run.test.mjs` |
| query-values | Every query value in order without nesting, and the raw query (HY-56) | implemented | `make test-php`, `make test-node` |
| form-values | Every form value of an urlencoded or multipart body in order without nesting (HY-57) | implemented | `make test-php`, `make test-node` |
| request-boundary | UTF-8 checks, plain 500 errors, data model checks, hardened session cookie, redirect checks, failure marks (HY-42 to HY-47) | implemented | `make test-php`, `make test-js`, `make e2e` |
| benchmark | Server and browser performance measurement: request cost, rendering per row count, first screens, `hy-set` main thread load and memory over navigation | implemented | `make bench`, [Benchmark](operations/benchmark.md) |
| server-program | PHP rendering with the native template extension, or with the generated PHP program of the same templates (HY-48) | implemented | `make test-php`, `make parity` |
| cdn-deployment | Server and CDN deployment (recommended) and static shell deployment | documented, not deployed | [Deployment](operations/deployment.md) |
| other-servers | Server packages for languages other than PHP and Node.js | not started | |
| publication | Registry publication of the packages | not started | |
