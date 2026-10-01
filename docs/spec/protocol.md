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
    { "name": "board.list", "path": "/board", "title": "Board", "template": "board/list.tpl" },
    { "name": "board.create", "path": "/board/create", "title": "Write", "template": "board/create.tpl", "post": true },
    { "name": "board.show", "path": "/board/{id}", "title": "Post", "template": "board/show.tpl" }
  ]
}
```

- **HY-2** `regions` and `routes` are ordered lists. Region names and route names are unique. A region name matches `[A-Za-z][A-Za-z0-9_-]*` and is neither `layout` nor `title`. Exactly one region has `"page": true` and no `template`; every other region has a `template` and a list of used topics. A route with `"post": true` accepts a `POST` action.
- **HY-3** The layout renders the title definition inside `<title>` with `{# title}`, and each region with `{# name}` inside an element whose `id` is the region name and that carries the attribute `hy-region`, for example `<main id="content" hy-region>{# content}</main>`.

## Routing

- **HY-4** A route path starts with `/`. The segments after it are separated by `/`. A segment is either a literal of the characters `A-Z a-z 0-9 . _ ~ -` or a parameter `{name}` where `name` matches `[A-Za-z_][A-Za-z0-9_]*`. The path `/` has no segments.
- **HY-5** A request path matches a route when it starts with `/`, has the same number of segments, every literal segment is equal to the request segment byte for byte, and every parameter segment is non-empty. The query string is not part of the path.
- **HY-6** A parameter value is the request segment with every `%XX` sequence (two hexadecimal digits) decoded to its byte. A segment with a `%` that is not followed by two hexadecimal digits, or whose decoded bytes are not valid UTF-8, does not match.
- **HY-7** Routes are tried in manifest order, and the first route that matches is the result. A path that matches no route has no result.
- **HY-8** An application may run under a base path such as `/api`. A request path is routed after removing the base path; a request path that does not start with the base path followed by `/` or the end of the path has no result. `Location` headers include the base path.
- **HY-9** `conformance/routes.json` holds routes and request paths with their expected results. The PHP router and the JavaScript router both pass every case.

## Data and topics

- **HY-10** Shared data is one map that the layout, the title and every region receive. It starts with `title`, the route title, followed by the values that the application adds, such as `csrf`.
- **HY-11** Every non-page region declares the topics it uses. A topic names data that can change, such as `posts`. The topic `path` is built in: it changes when the request path differs from the path of the `HX-Current-URL` request header after removing the base path.

## Rendering

- **HY-12** A document is the layout rendered with root data equal to the shared data and with the definitions `layout` (the layout template), `title` (the title template) and one definition per region, `{ "template": <template>, "data": <region data> }`. The page region template is the route template.
- **HY-13** A region rendered alone uses the region template and the root data `merge(shared, region data)`, where a region data value replaces a shared value with the same name. The title rendered alone uses the title template and the shared data. These are the context data orders of a block (template runtime rule RT-26), so a part rendered alone produces the same bytes as the same part inside the document.
- **HY-14** Server and browser render with the same environment. The server sends the time zone in every JSON response.

## Requests

- **HY-15** A request with `Accept: application/json` and `Hy-Region: <name>` is a region request. A request with `Accept: application/json` and no `Hy-Region` is a document request. Any other request is an HTML request and receives an HTML document.
- **HY-16** A region request whose region is not the page region fails with status 400.

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
    "left": { "count": 3 }
  }
}
```

- **HY-18** For a document request, `regions` contains every region in manifest order. For a region request, it contains the page region first, then every other region that uses a changed topic, in manifest order.
- **HY-19** The changed topics of a request are the topics recorded by the previous action (HY-25) and `path` (HY-11).

## Browser

- **HY-20** The browser code routes the response URL path (after removing the base path) with the manifest routes. The route name must equal `route` in the response; otherwise rendering fails. The page region template is the template of that route.
- **HY-21** The htmx extension requests JSON only when the request target element carries `hy-region`. It converts a JSON region response into this HTML and gives it to htmx in place of the response text: `<title>` with the title rendered alone, then the page region rendered alone, then `<hx-partial hx-target="#<name>" hx-swap="innerMorph">` with each other region rendered alone. htmx then performs the swap, the title change and the history update. A response whose content type is not `application/json` passes unchanged.
- **HY-22** In client-side rendering, a static shell declares the base path of the server with `<meta name="hyper-api" content="/api">`. The browser code requests the document JSON for the current path, renders the document (HY-12), replaces the title and the body with the rendered ones, and lets htmx process the new body. A current path that matches no route renders the body text `Not Found`.
- **HY-23** In client-side rendering, the extension prefixes same-origin request paths with the base path, removes the base path from history paths, and replaces htmx history restoration with HY-22 for the restored path.

## Actions

- **HY-24** An action request must contain the form field `_csrf` equal to the session token; otherwise the server responds with status 403 and runs no action.
- **HY-25** An action that succeeds returns a redirect. The server responds with status 303 and `Location`, stores the flash values and the changed topics in the session, and removes them after the next request reads them. The browser follows the redirect with the same headers, and htmx records the final URL in history.
- **HY-26** An action that rejects its input returns invalid data. The server responds with status 422 and renders the route page with the route data merged with the invalid data, as JSON for a JSON request and as a document otherwise.

## Errors

- **HY-27** A path without a route, or a loader that reports a missing resource, responds with status 404. A method other than `GET` or a declared `POST` responds with status 405.
- **HY-28** An error in the browser code is thrown from the htmx response hook. htmx reports it with the `htmx:error` event and does not swap.
