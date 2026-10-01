# Deployment

[한국어](deployment.ko.md).

One application deploys in two forms. Both use the same manifest, templates, client bundle and PHP handlers.

| Form | First document | Later navigation | Use |
|---|---|---|---|
| Server and CDN (recommended) | PHP renders it (SSR) | JSON, rendered by the browser | Every application whose server can render HTML |
| Static shell | The browser renders it from `/api` JSON (CSR) | JSON, rendered by the browser | A backend that serves JSON only |

## Server and CDN (recommended)

The server tells the two kinds of requests apart by their headers (HY-15). A direct request (the address bar, a reload, a bookmark, a search crawler or a link preview bot) has no `Hy-Region` and receives the complete document. A request from htmx inside a page carries `Accept: application/json` and `Hy-Region` and receives JSON, which the browser renders. Search engines and link previews therefore always receive complete documents with their titles.

| Path pattern | Origin | Behavior |
|---|---|---|
| `/assets/*` | S3 bucket with `public/assets` | `GET` and `HEAD`. The client script and the template files carry content hashes in their names: `Cache-Control: public, max-age=31536000, immutable`. |
| default (`*`) | PHP server | All methods, no caching, forward the `Cookie` (the session cookie and `hy-keep`), `Accept`, `Hy-Region`, `HX-Request`, `HX-Current-URL` and `Content-Type` headers and the query string. |

PHP runs without a base path. Responses carry `Vary: Accept, Hy-Region, HX-Current-URL`.

Deploy `build/server`, which `make server` writes, next to the PHP code; the application opens it with `App::open(program: ...)`. For the fastest rendering, build the native template extension with `make ext` for the PHP version of the server and load it with the `extension` setting of `php.ini`. Without the extension, PHP renders with the generated program in `build/server/program.php` (HY-48).

## Static shell

`make assets` writes `examples/board/dist/csr/`: `index.html` with the stylesheet and the client script inlined, and `assets/templates/` with one file per template.

1. Upload `index.html` to an S3 bucket with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`, and `assets/templates/*` with `Content-Type: application/json` and `Cache-Control: public, max-age=31536000, immutable`.
2. Run PHP with the environment variable `BOARD_BASE_PATH=/api` (HY-8).
3. Route `/api/*` to PHP as in the table above, `/assets/*` to S3, and every other path to `/index.html` with a CloudFront Function on viewer request.
4. Send a Content Security Policy that allows the inline script and stylesheet by hash; `make assets` prints the hashes.

Every page path returns the same empty shell, so search crawlers that do not run JavaScript and link preview bots see no content and no title. Use this form only for screens that do not need them.

## Server settings

- Set `display_errors=Off` in the PHP configuration (`php.ini`, PHP-FPM pool, or `php -d display_errors=0`). PHP writes startup warnings, such as an exceeded `max_input_vars`, before the application runs. An exception inside the application answers 500 without details and is logged (HY-43).
- The session cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` on HTTPS (HY-45). Behind a CDN that terminates TLS, PHP receives plain HTTP: open the application with `https: true` (the example reads `BOARD_HTTPS=1`) so that the cookie stays `Secure`.
- Every response carries `Content-Security-Policy: frame-ancestors 'self'` (HY-45). `App::open(frameAncestors: ...)` changes the sources; the example reads `BOARD_FRAME_ANCESTORS`. A static shell on S3 needs the same header from a CloudFront response headers policy, because `frame-ancestors` has no effect in a `<meta>` policy.

## Local reproduction

`make serve-demo` runs both forms on one database:

| URL | Role |
|---|---|
| `http://127.0.0.1:8080/board` | Server form: PHP at the root |
| `http://127.0.0.1:8082/api/board` | PHP with `BOARD_BASE_PATH=/api` |
| `http://127.0.0.1:8081/board` | Static shell: `scripts/serve-edge.mjs` returns files of `dist/csr/`, the shell for every other path, and forwards `/api/*` to port 8082 |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | The comparison page: both forms in two frames and the result of comparing their bodies. It is a development tool and is not part of a deployment. |
