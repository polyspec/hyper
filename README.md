# hyper

[한국어](README.ko.md).

hyper renders pages with template language templates in two modes from one application:

- **SSR**: PHP routes the request and renders the document from the templates. After that, links and forms request JSON and the browser renders the changed regions.
- **CSR**: one static file, `index.html`, is served for every path. The browser routes the path, requests JSON from PHP under `/api` and renders the whole document. This form is for backends that serve JSON only; the recommended deployment serves direct requests with SSR and htmx requests with JSON from one server (see [Deployment](docs/operations/deployment.md)).

Both modes read one manifest, `app.json` (layout, title, regions and routes), and render the same templates. The screen is a function of data: a part that changes in the browser is a route region, and `hy-set="notice.closed=true"` or `set('notice', 'notice.closed', true)` changes its data and renders it again without a request. A region declares which data paths survive a reload and where they are kept: `server`, `cookie`, `localStorage` or `sessionStorage`. Templates load per route. The PHP router and the browser router pass the same conformance cases, and the browser renders the same bytes as PHP for every page of the example. htmx 4 performs navigation, form submission, swaps and history.

Templates use the template language without changes. A layout places regions with block tags:

```
<title>{# title}</title>
<body hx-boost:inherited="true" hx-target:inherited="#content" hx-swap:inherited="innerMorph">
<aside id="left" hy-region>{# left}</aside>
<main id="content" hy-region>{# content}</main>
</body>
```

Pages and regions contain no `hx-*` attributes. Links and forms are plain HTML and also work without JavaScript in SSR.

## Packages

| Path | Name | Role |
|---|---|---|
| `packages/hyper-js` | `@polyspec/hyper` | Browser code: manifest, router, region and document rendering, htmx extension, client-side rendering |
| `packages/hyper-php` | `polyspec/hyper` | Server: manifest, router, actions, region selection, documents and JSON |
| `examples/board` | | Board example: layout, left and content regions; list, detail, create, validation |
| `conformance/routes.json` | | Router cases that both routers pass |

## Start

The template repository must be next to this repository (`../template`).

```sh
make install
make template
make serve-demo
```

- SSR: `http://127.0.0.1:8080/board`
- CSR: `http://127.0.0.1:8081/board`
- Comparison of both in two frames: `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080`

`make help` lists every target. `make check` runs every check.

## Documents

- [Region protocol](docs/spec/protocol.md) defines the manifest, routing, rendering and the request and response contract.
- [Screen composition](docs/spec/composition.md) defines which mechanism a screen part uses: HTML and CSS, a block, or a region.
- [Feature status](docs/features.md) records implementation and verification.
- [Development](docs/operations/development.md) describes the checks and the asset build.
- [Deployment](docs/operations/deployment.md) describes SSR and CSR deployment, including S3 and CloudFront.
- [Benchmark](docs/operations/benchmark.md) describes the performance measurement and its results.
- [Dependencies](docs/operations/dependencies.md) records pinned versions.
- [Changelog](CHANGELOG.md) records changes and their verification.
