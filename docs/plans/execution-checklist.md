# Execution checklist

[한국어](execution-checklist.ko.md).

This document lists the planned tasks of hyper, the verification command of each task and its completion. The rules are in [the protocol](../spec/protocol.md), the status of each feature in [Feature status](../features.md) and the actual changes in [the changelog](../../CHANGELOG.md).

## How to use

- Task ID format: `H<wave>.<number>`.
- The last column of every task row is its state (AGENTS): `[ ]` waiting, `[~]` in progress, `[o]` done, `[!] cause: <cause>; retry: <condition>` bypassed. A task is `[o]` only after its verification command passed on the committed tree.
- A task changes the specification first, then adds failing tests that cite the rule identifiers, then changes the implementation.
- A wave starts when the waves that it names as dependencies are done.

## Wave 1 — CSRF protection that an application cannot weaken

Depends on: none.

| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Specify the masked token (HY-24, HY-10, HY-71), the session cookie name (HY-45), session renewal (HY-72) and the private page cache (HY-52); add `conformance/csrf.json` | `make docs-check` | [o] |
| H1.2 | PHP server: mask the token in every response and accept only a masked value (HY-24); name the session cookie `__Host-hy-session` or `hy-session` (HY-45); renew the session in an action and fail a renewal in a loader (HY-72); refuse a `Cache-Control` that a shared cache may store (HY-52) | `make test-php` | [o] |
| H1.3 | Node server: the same rules as H1.2, and `FileSessions` without a cookie name option | `make test-node` | [o] |
| H1.4 | Example, browser tests, parity, feature status, deployment procedure and changelog for H1.1 to H1.3 | `make check` | [o] |

## Wave 2 — Send only the data that the templates read

Depends on: Wave 1.

| ID | Task | Verification | Status |
|---|---|---|---|
| H2.1 | Specify the read paths of a route: the paths that the layout, the title and the region templates read through their includes and blocks, the kept paths of the route regions, and `csrf` when a route region keeps a value on the server; the server sends only those paths of the shared and region data | `make docs-check` | [o] |
| H2.2 | Browser package: compute the read paths of every route from the template ASTs, with cases for variables, members, indexes, loops, assignments, includes, blocks, function arguments and operators | `make test-js` | [o] |
| H2.3 | Server build: write the read paths for the PHP server; PHP server: remove every path outside them before rendering and encoding | `make test-php` | [o] |
| H2.4 | Node server: the same removal as H2.3 from the read paths of the browser package; shared cases in `conformance/reads.json` | `make test-node` | [o] |
| H2.5 | Example, parity, browser tests, bundle size, feature status, README and changelog for H2.1 to H2.4 | `make check` | [o] |
| H2.6 | Read paths of a loop variable only in the body of its loop, so that a loop variable that rebinds a name that an earlier assignment read ends the analysis; two cases in `conformance/reads.json` and a time limit for every case | `make test-js` | [o] |

## Wave 3 — Fail on a defect instead of continuing

Depends on: none.

| ID | Task | Verification | Status |
|---|---|---|---|
| H3.1 | Specify that a PHP warning or notice during a request, such as an undefined variable or array key, fails the request as HY-43 does | `make docs-check` | [o] |
| H3.2 | PHP server: turn every warning and notice of a request into an exception with a failing test for each kind | `make test-php` | [o] |
| H3.3 | Run static analysis of the PHP package at its highest level in `make check` and fix every finding | `make check` | [o] |

## Wave 4 — Route regions of composed pages

Depends on: Wave 2.

| ID | Task | Verification | Status |
|---|---|---|---|
| H4.1 | Specify absent route regions and their placement: a route region loader that returns null makes the region absent from the response (no data, no kept entries, no definition, so `{?# name}` is false); a template that the route template includes or places by path may place a route region; a present route region has exactly one element on the page, which the browser checks; the template check follows includes and blocks | `make docs-check` | [o] |
| H4.2 | PHP server: absent route regions in documents and JSON | `make test-php` | [o] |
| H4.3 | Browser package and Node server: absent route regions in rendering, held data and embedded data, and the element check | `make test-js`, `make test-node` | [o] |
| H4.4 | Template check, example (the notice route region is absent when there is no notice), browser tests, parity, feature status and changelog | `make check` | [o] |

## Wave 5 — Load only the templates that rendering reaches

Depends on: none. The browser loads every template that the templates of a route reference, transitively (HY-35). A page that selects views at request time with one route whose dispatch template references every view loads every view template on every page, also the views that it does not render.

| ID | Task | Verification | Status |
|---|---|---|---|
| H5.1 | Specify that the browser loads a template when rendering reaches it: it renders, loads every template that the rendering requested and the loader did not hold, and renders again; a template that no rendering reaches is not loaded | `make docs-check` | [o] |
| H5.2 | Browser package: render with on-demand loading in region responses, client-side rendering, embedded data, `render` and `set`, with a test that a branch not taken loads no template | `make test-js` | [o] |
| H5.3 | Example, browser tests, bundle size, feature status and changelog | `make check` | [o] |

## Wave 6 — Request only the resources that a page uses

Depends on: wave 5. A page must request only the resources that it uses, each once, for templates, stylesheets and scripts alike. The asset build breaks that rule in three places. It writes the client code into one file, so an application cannot load code that only some pages use when such a page needs it. The static shell inlines `app.css`, which the rendered layout links as well, so a client-rendered page loads it twice. The build writes `public/assets/manifest.json` with the board example names `css` and `reader`, which another application does not have. The header comments of `scripts/build-assets.mjs` and `scripts/build-templates.mjs` still describe the index with referenced templates, which wave 5 removed.

| ID | Task | Verification | Status |
|---|---|---|---|
| H6.1 | Specify HY-76: a page requests only the resources that it uses, each at most once; the asset build writes the client entry and one chunk file per code that the entry imports with `import()`, `manifest.json` with the entry URL only, and a static shell without a stylesheet | `make docs-check` | [o] |
| H6.2 | Asset build: chunk files, the manifest, the shell and the comments, with a build test that fails before the change | `make test-scripts` | [o] |
| H6.3 | Board example: the layout links its own stylesheets; documents, bundle size, feature status and changelog | `make check` | [o] |

## Wave 7 — Four task states

Depends on: none. Every checklist uses four task states: `[ ]` waiting, `[~]` in progress, `[o]` done and `[!]` bypassed with a cause and a retry condition. This checklist used `[x]` and `[ ] blocked: <reason>`, and no check read the states.

| ID | Task | Verification | Status |
|---|---|---|---|
| H7.1 | Accept only the four task states in `scripts/check-documents.mjs`, the same in both languages, with the cause and the retry condition of a bypassed task; check it fails on the `[x]` rows; write every done task as `[o]`; state the checklist rules in AGENTS | `make docs-check` | [o] |

## Wave 8 — Tailwind CSS in the asset build

Depends on: wave 6. Templates that style pages with Tailwind CSS use utility classes, and the asset build has no step that compiles a stylesheet with the Tailwind classes that the templates use.

| ID | Task | Verification | Status |
|---|---|---|---|
| H8.1 | Specify HY-77: `--tailwind <source>=<output>` compiles the source stylesheet of the application with the theme and the utilities of the latest stable Tailwind CSS, generating the utilities that the templates and the client code use, and writes the rules of the source in the cascade layer `components` | `make docs-check` | [o] |
| H8.2 | Asset build: the option, with a build test that fails before the change; Tailwind CSS as a dependency; documents and changelog | `make check` | [o] |
| H8.2-1 | Compile the Tailwind stylesheet before the static deployment copies the stylesheets: the build wrote the output after the copy, so `dist/csr/assets/` missed the output of a first build and held the output of the earlier build after a later one | `make check` | [o] |

## Wave 9 — The value of the client rendering selection reaches the handlers

Depends on: none. The selection of HY-62 returns only `true` or `false`, so an application whose selection reads stored data, such as the service of the `Host` header, reads the same data again in its handlers, once in the selection and once more in a handler of the same request. The selection returns a choice with a value, and every handler of the request reads that value from its request.

| ID | Task | Verification | Status |
|---|---|---|---|
| H9.1 | Specify in HY-62: the selection returns a choice, whether the request is of a client-rendered page and a value; every loader and action of the request reads the value from its request, and a request of an application without the declaration has the value null | `make docs-check` | [~] |
| H9.2 | PHP and Node servers: `Choice`, `Request::selection()` and `request.selection()`, with tests that fail before the change; documents, feature status and changelog | `make check` | [~] |
