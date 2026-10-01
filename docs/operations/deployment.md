# Deployment

[한국어](deployment.ko.md).

The same application deploys in two forms. Both use the same manifest, templates, client bundle and PHP handlers.

| Form | What runs where |
|---|---|
| Server-side rendering (SSR) | PHP serves documents at the root, region JSON for htmx requests, and `public/assets` (stylesheet and the client script). |
| Client-side rendering (CSR) | Object storage serves `dist/csr/index.html` for every page path and the template files under `/assets/templates/`. PHP serves JSON under `/api`. |

## CSR with S3 and CloudFront

`make assets` writes `examples/board/dist/csr/`. `index.html` contains the stylesheet and the client script (htmx, the hyper browser code, the template render runtime, the manifest and the template index). `assets/templates/` contains one file per template; a route loads only its own templates (HY-35).

1. Upload `index.html` to an S3 bucket with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`. Upload `assets/templates/*` with `Content-Type: application/json` and `Cache-Control: public, max-age=31536000, immutable`; their names contain a content hash, so a new deployment adds files and never changes one.
2. Run the PHP application with the environment variable `BOARD_BASE_PATH=/api`. The router removes `/api` before routing and adds it to `Location` headers (HY-8).
3. Create one CloudFront distribution with two origins:

| Path pattern | Origin | Behavior |
|---|---|---|
| `/api/*` | PHP server | All methods, no caching, forward the `Cookie` (the session cookie and `hy-keep`), `Accept`, `Hy-Region`, `HX-Current-URL`, `HX-Request` and `Content-Type` headers and the query string. |
| `/assets/*` | S3 bucket | `GET` and `HEAD`, cached by the object headers. |
| default (`*`) | S3 bucket | `GET` and `HEAD`. A CloudFront Function on viewer request sets the URI to `/index.html`, so every page path receives the shell. |

Because the shell and the API share one origin, the browser sends the session cookie to `/api` without cross-origin requests, and no CORS configuration is needed.

4. Send a Content Security Policy that allows the inline script and stylesheet by hash. `make assets` prints the policy, for example `script-src 'sha256-...'; style-src 'sha256-...'`. The hashes change with every build.

The shell is not cached, so every visit downloads the inlined script (about 30 KB gzip). Template files are cached until their content changes.

## Local reproduction

`make serve-demo` reproduces both forms on one database:

| URL | Role |
|---|---|
| `http://127.0.0.1:8080/board` | SSR: PHP at the root |
| `http://127.0.0.1:8082/api/board` | PHP with `BOARD_BASE_PATH=/api` |
| `http://127.0.0.1:8081/board` | CSR: `scripts/serve-edge.mjs` returns files of `dist/csr/`, the shell for every other path, and forwards `/api/*` to port 8082, as the CloudFront distribution does |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | The comparison page: SSR and CSR in two frames, with the result of comparing their bodies |
