# Region protocol

[한국어](protocol.ko.md).

This document defines the application manifest, routing, rendering, the requests and responses between a hyper server and the hyper browser code, and the two rendering modes. The server can render the first document as HTML (server-side rendering, SSR), or a static shell can render it in the browser (client-side rendering, CSR). Template syntax and rendering rules are defined by the template language; this document does not change them.

## Application manifest

- **HY-1** An application declares its structure in one JSON file, the manifest. Server and browser read the same manifest.

```json
{
  "layout": "layout.tpl",
  "title": "title.tpl",
  "regions": [
    { "name": "left", "template": "left.tpl", "uses": ["posts", "path"] },
    { "name": "content", "page": true }
  ],
  "routes": [
    { "name": "board.list", "path": "/board", "title": "Board", "template": "board/list.tpl", "regions": [{ "name": "rows", "template": "board/rows.tpl" }] },
    { "name": "board.create", "path": "/board/create", "title": "Write", "template": "board/create.tpl", "post": true },
    { "name": "board.show", "path": "/board/{id}", "title": "Post", "template": "board/show.tpl" }
  ]
}
```

- **HY-2** `regions` and `routes` are ordered lists. Region names and route names are unique. A region name matches `[A-Za-z][A-Za-z0-9_-]*` and is not `layout`, `title` or `data`. Exactly one region has `"page": true` and no `template`; every other region has a `template` and a list of used topics. A route with `"post": true` accepts a `POST` action.
- **HY-3** The layout renders the title definition inside `<title>` with `{# title}`, the data definition with `{# data}` (HY-31), and each region with `{# name}` inside an element whose `id` is the region name and that carries the attribute `hy-region`, for example `<main id="content" hy-region>{# content}</main>`.

## Routing

- **HY-4** A route path starts with `/`. The segments after it are separated by `/`. A segment is either a literal of the characters `A-Z a-z 0-9 . _ ~ -` or a parameter `{name}` where `name` matches `[A-Za-z_][A-Za-z0-9_]*`. The path `/` has no segments.
- **HY-5** A request path matches a route when it starts with `/`, has the same number of segments, every literal segment is equal to the request segment byte for byte, and every parameter segment is non-empty. The query string is not part of the path.
- **HY-6** A parameter value is the request segment with every `%XX` sequence (two hexadecimal digits) decoded to its byte. A segment with a `%` that is not followed by two hexadecimal digits, or whose decoded bytes are not valid UTF-8, does not match.
- **HY-7** Routes are tried in manifest order, and the first route that matches is the result. A path that matches no route has no result.
- **HY-8** An application may run under a base path such as `/api`. A request path is routed after removing the base path; a request path that does not start with the base path followed by `/` or the end of the path has no result. `Location` headers include the base path.
- **HY-9** `conformance/routes.json` holds routes and request paths with their expected results. The PHP router and the JavaScript router both pass every case.

## Data and topics

- **HY-10** Shared data is one map that the layout, the title and every region receive. It starts with `title`, the route title, and `csrf`, the session token of HY-24, followed by the values that the application adds.
- **HY-11** Every non-page region declares the topics it uses. A topic names data that can change, such as `posts`. The topic `path` is built in: it changes when the request path differs from the path of the `HX-Current-URL` request header after removing the base path.

## Rendering

- **HY-12** A document is the layout rendered with root data equal to the shared data and with the definitions `layout` (the layout template), `title` (the title template) and one definition per region, `{ "template": <template>, "data": <region data> }`. The page region template is the route template.
- **HY-13** A region rendered alone uses the region template and the root data `merge(shared, region data)`, where a region data value replaces a shared value with the same name. The title rendered alone uses the title template and the shared data. These are the context data orders of a block (template runtime rule RT-26), so a part rendered alone produces the same bytes as the same part inside the document.
- **HY-14** Server and browser render with the same environment. The server sends the time zone in every JSON response.

## Requests

- **HY-15** A request with `Accept: application/json` and `Hy-Region: <name>` is a region request. A request with `Accept: application/json` and no `Hy-Region` is a document request. Any other request is an HTML request and receives an HTML document.
- **HY-16** A JSON request whose `Hy-Region` value is not the page region fails with status 400 before any loader or action runs.

## JSON response

- **HY-17** A JSON response has this shape. Keys keep their order.

```json
{
  "env": { "timezone": "+09:00" },
  "route": "board.show",
  "params": { "id": "7" },
  "shared": { "title": "Post", "csrf": "token" },
  "regions": {
    "content": { "post": { "id": 7 } },
    "reader": { "large": false },
    "left": { "count": 3 }
  },
  "kept": {
    "reader": { "large": true }
  }
}
```

`regions` holds the loader data. `kept` holds, by region and path, the `server` and `cookie` kept values that the server read for the regions in `regions` and that conform to the region data (HY-38). A region without such values has no entry.

- **HY-18** For a document request, `regions` contains every region in manifest order. For a region request, it contains the page region first, then every other region that uses a changed topic, in manifest order.
- **HY-19** The changed topics of a request are the topics recorded by the previous action (HY-25) and `path` (HY-11).

## Browser

- **HY-20** The browser code routes the response URL path (after removing the base path) with the manifest routes. The route name must equal `route` in the response; otherwise rendering fails. The page region template is the template of that route.
- **HY-21** The htmx extension requests JSON only when the request target element carries `hy-region`. It converts a JSON region response into this HTML and gives it to htmx in place of the response text: `<title>` with the title rendered alone, then the page region rendered alone, then `<hx-partial hx-target="#<name>" hx-swap="innerMorph">` with each other region rendered alone. htmx then performs the swap, the title change and the history update. A response whose content type is not `application/json` passes unchanged.
- **HY-22** In client-side rendering, a static shell declares the base path of the server with `<meta name="hyper-api" content="/api">`. The browser code requests the document JSON for the current path while it loads the templates of the route (HY-35), renders the document (HY-12), replaces the title and the body with the rendered ones, and lets htmx process the new body. A current path that matches no route renders the body text `Not Found`.
- **HY-23** In client-side rendering, the extension prefixes the same-origin request path of every region request with the base path, removes the base path from history paths, and replaces htmx history restoration with HY-22 for the restored path. A later restoration cancels an earlier one that is still loading, and only the latest one is rendered.

## Actions

- **HY-24** An action request must contain the form field `_csrf` equal to the session token; otherwise the server responds with status 403 and runs no action.
- **HY-25** An action that succeeds returns a redirect. The server responds with status 303 and `Location`, stores the flash values and the changed topics in the session, and removes them after the next request reads them. The browser follows the redirect with the same headers, and htmx records the final URL in history.
- **HY-26** An action that rejects its input returns invalid data. The server responds with status 422 and renders the route page with the route data merged with the invalid data, as JSON for a JSON request and as a document otherwise.

## Data

- **HY-29** The output of a region is a function of its template, the shared data and the region data. The browser changes the page only by replacing region data and rendering it. Form controls hold the values that a user is entering; every other screen state, such as a sort order or an open panel, is region data.
- **HY-30** A route may declare route regions, for example `"regions": [{ "name": "rows", "template": "board/rows.tpl" }]`. A part of a page that changes in the browser without a request is a route region. The route template places each route region with `{# name}` inside an element whose `id` is the region name and that carries `hy-region`. Region names are unique across the manifest regions and every route region. Each route region has its own loader. A document and the page region pass every route region as a definition `{ "template": <template>, "data": <data> }`, and every JSON response that contains the page region contains the route regions right after it.
- **HY-31** The layout places `{# data}` once, before `</body>`. The definition `data` renders the reserved template `hyper/data.tpl`, whose source is exactly `<script type="application/json" id="hy-data">{= json(response) | raw}</script>`, with `response` equal to the document JSON value (HY-17 with every region, HY-18). The server and the browser render it the same way, so a document keeps the same bytes in both. A region request does not render it.

## Browser data

- **HY-32** The browser holds the data of the last response that it rendered: the environment, the route, the parameters, the shared data and the data of every region in the response. When the page loads, and when htmx restores a page from history by requesting its HTML, the browser reads the data from the element `#hy-data`, replaces all held data with it and starts loading the templates of the route (HY-35). `render` (HY-33) replaces held region data.
- **HY-33** The browser code provides `data(region)`, which returns the held data of a region; `render(region, data)`, which replaces the held data of a region; and `set(region, path, value)`, which replaces one value at a dotted path (map keys and list indexes) in the held data of a region. A path that the data does not contain fails. `render` and `set` then render the region alone (HY-13) and swap it into the region element with `innerMorph`. The page region uses the template of the held route and passes the held route regions as definitions. These operations send no request. There is no change tracking: the code that changes data asks for the rendering. Calls run one after another in call order, and each starts from the held data that the previous call left. When held data is replaced (HY-32) while a call renders, the call ends without swapping, holding or storing.
- **HY-36** A template may give an element the attribute `hy-set="path=value; path=value"`, where each value is a JSON literal and each path follows HY-33. A click on the element, or on an element inside it, runs every assignment in the held data of the closest enclosing region and renders that region once. The template computes the assigned values, for example `hy-set="service.close.flag={? service.close.flag}0{:}1{/}"`. `hy-set` works only with JavaScript.

## Template delivery

- **HY-34** The asset build writes every template AST to its own file whose name contains a hash of its content, and an index that maps each template name to its file URL and to the names of the templates that its include and block tags reference by path. The index also contains `hyper/data.tpl`. The client bundle contains the index and the name of `hyper/data.tpl`, and no template.
- **HY-35** Before rendering, the browser loads the templates that a route needs: the layout, the title, `hyper/data.tpl`, every non-page region template, the route template and every route region template, together with every template that they reference, transitively. For a region request the loading starts with the request and runs at the same time. When the response URL routes to another route, such as after a redirect, the browser loads the templates of that route before rendering. Loaded templates stay loaded until the page unloads.

## Kept data

- **HY-37** A non-page region or a route region may declare kept paths, for example `"keep": { "notice.closed": "server", "sort": "localStorage" }`. A path follows HY-33. A kept value survives a reload in the storage named by its kind:

| Kind | Storage | Request when the value changes | First SSR document |
|---|---|---|---|
| `server` | the server session | one background request that rendering does not wait for | contains the value |
| `cookie` | the cookie `hy-keep`, written by the browser code; it cannot be `HttpOnly` | none | contains the value |
| `localStorage` | the browser `localStorage` | none | contains the loader value; the browser renders the kept value after it loads |
| `sessionStorage` | the browser `sessionStorage` of the tab | none | contains the loader value; the browser renders the kept value after it loads |

- **HY-38** The value that the user set last in the browser takes precedence; the loader data is the default. A kept value conforms to the value at its path when the region data contains the path, the kept value is a value of the template data model (an integer outside ±(2^53 − 1) is not), and:
  - a null, boolean, number or string has the same type;
  - a map replaces a map; when the data map has keys, the kept map has the same keys and the value of every key conforms to the value of the same key;
  - a list replaces a list; when the data list has items, every kept item conforms to its first item.

  An empty data map or list gives no shape, so any map or list conforms to it; the rendering check below covers such values.

  A kept value that does not conform is ignored.
  - The server reads `server` and `cookie` values and sends the conforming ones in `kept` (HY-17). They never change `regions`.
  - A region renders with its kept values applied to its data in this order: the values in `kept`, the `localStorage` and `sessionStorage` values, and the `server` values whose saving has not completed (HY-39). The server applies only the values in `kept`. The browser applies all of them to the data that it holds and renders, and does not synchronize them with the server. For a document rendered by the server, the browser applies them after loading and renders every region whose data changed.
  - When a region does not render alone (HY-13) with its kept values applied, it renders with its loader data, and its kept values are removed from `kept` and from the held data. Route regions are checked before the page region, because the page region includes them (HY-30). The server removes them before it renders the embedded data (HY-31), so the server and the browser render the same document. When the region does not render with its loader data either, rendering fails (HY-43, HY-47).
- **HY-39** When `set`, `render` or `hy-set` changes a path, the browser renders the region first and then stores every kept path that equals the changed path, lies under it or contains it, with the value now at the kept path. A `server` value stays pending until the server answers 204 for it or a later change of the same path is saved; while it is pending it is applied as in HY-38. Saves of one path are sent one at a time: a change made while a save of its path is in flight is sent after that save completes, and only the latest value is sent. A failed save keeps the value pending and marks the region as failed (HY-47) when no later change of the path exists. For `server` it sends `POST <base path>/_hyper/keep` with the form fields `_csrf` (the held `shared.csrf`, HY-10), `region`, `path` and `value` (the JSON text of the value) and does not wait for the response. For `cookie` it writes `hy-keep` with `Path=/`, `SameSite=Lax`, `Max-Age` of one year and, on HTTPS, `Secure`. The cookie value is the URL-encoded JSON object `{ "<region>": { "<path>": <value> } }`.
- **HY-40** The server answers `POST <base path>/_hyper/keep` with status 204 after it stores the value in the session, with status 403 when the CSRF token does not match, and with status 400 when the region does not declare the path as `server`, the value is not JSON, the JSON text is longer than 4,096 bytes, or the value is not a value of the template data model. The path `/_hyper/keep` is reserved; a route path may not start with `/_hyper`.
- **HY-41** `conformance/keep.json` holds region data, kept values and the expected data after HY-38. The PHP and JavaScript implementations both pass every case.

## Request boundary and failures

- **HY-42** The request path is the path of the request target: the target up to its first `?` or `#`, and for an absolute-form target (`http://host/path`) the part after the authority. It is not decoded further. The path, every query and form name and value at any depth, and the `HX-Current-URL` header must be valid UTF-8; otherwise the server responds with status 400 before any loader or action runs. Cookies are not checked: the server ignores a `hy-keep` cookie that is not a JSON object, ignores its values that do not conform (HY-38), and starts a new session for a session cookie that is not an identifier that it created (HY-45).
- **HY-43** An exception that the application does not handle produces status 500 with the text `Internal Server Error`. The response contains no exception message, file path or stack trace; the server writes them to its log. The PHP setting `display_errors` must be off before PHP starts the request, because PHP writes startup warnings (for example `max_input_vars`) before the application runs.
- **HY-44** Shared data and region data are values of the template data model. An integer outside ±(2^53 − 1) fails with HY-43, for a document and for JSON alike.
- **HY-45** The server session cookie is `HttpOnly` and `SameSite=Lax`. It is `Secure` when the request uses HTTPS or when the application declares that it is served over HTTPS, which a server behind a TLS-terminating proxy must do. The server accepts only session identifiers that it created. Every response carries `Content-Security-Policy: frame-ancestors <sources>`, where the application sets the sources and the default is `'self'`.
- **HY-46** A redirect location is an application path: valid UTF-8 that starts with `/`, whose second character is neither `/` nor `\`, that contains no control character (C0, DEL or C1), no space and no `\`, and whose path has no segment `.` or `..`, also when a dot is percent-encoded (`%2e`).
- **HY-47** When a region request receives a response that is not JSON, or when rendering, saving a kept value or loading templates fails, the browser does not swap and does not change history. It sets the attribute `hy-error` on the region element to the response status, or to `0` for a network or rendering failure, and removes the attribute from every region that renders successfully afterwards. A cancelled request is not a failure; a request that htmx aborts because its timeout (`hx-timeout`, or `htmx.config.defaultTimeout`) passed is a network failure. `render`, `set` and `hy-set` change held data only after the region rendered; a failure leaves held data unchanged. When client-side rendering of a document fails, the browser sets `hy-error` on the body.

## Errors

- **HY-27** A path without a route, or a loader that reports a missing resource, responds with status 404. A method other than `GET` or a declared `POST` responds with status 405.
- **HY-28** An error in the browser code is thrown from the htmx response hook. htmx reports it with the `htmx:error` event and does not swap.
