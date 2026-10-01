# Feature status

[한국어](features.ko.md).

| ID | Feature | Status | Evidence |
|---|---|---|---|
| protocol | Region protocol specification (HY-1 to HY-28) | implemented | [Protocol](spec/protocol.md) |
| manifest | Application manifest read by PHP and the browser | implemented | `make test-php`, `make test-js` |
| router | PHP and browser routers with shared conformance cases | implemented | `make test-php`, `make test-js` |
| hyper-js | Browser code: region and document rendering, htmx extension, client-side rendering | implemented | `make test-js`, `make e2e` |
| hyper-php | PHP server: routes, actions, CSRF, flash, changed topics, base path, documents and JSON | implemented | `make test-php` |
| parity | Browser documents and regions equal PHP documents byte for byte | implemented | `make parity` |
| ssr | Server-side rendering with JSON navigation and a no-JavaScript fallback | implemented | `make e2e` |
| csr | Client-side rendering from one static `index.html` and `/api` JSON | implemented | `make e2e` |
| comparison | Comparison page with SSR and CSR frames | implemented | `make e2e` |
| bundle-size | SSR script and CSR shell size limits | implemented | `make bundle-size` |
| cdn-deployment | CSR deployment on S3 and CloudFront | documented, not deployed | [Deployment](operations/deployment.md) |
| other-servers | Server packages for languages other than PHP | not started | |
| publication | Registry publication of the packages | not started | |
