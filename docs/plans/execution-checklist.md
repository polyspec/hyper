# Execution checklist

[한국어](execution-checklist.ko.md).

This document lists the planned tasks of hyper, the verification command of each task and its completion. The rules are in [the protocol](../spec/protocol.md), the status of each feature in [Feature status](../features.md) and the actual changes in [the changelog](../../CHANGELOG.md).

## How to use

- Task ID format: `H<wave>.<number>`.
- The last column of every task row is a checkbox: `[ ]` open, `[x]` done, `[ ] blocked: <reason>` when the task cannot proceed. Check a task only after its verification command passed on the committed tree.
- A task changes the specification first, then adds failing tests that cite the rule identifiers, then changes the implementation.
- A wave starts when the waves that it names as dependencies are done.

## Wave 1 — CSRF protection that an application cannot weaken

Depends on: none.

| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Specify the masked token (HY-24, HY-10, HY-71), the session cookie name (HY-45), session renewal (HY-72) and the private page cache (HY-52); add `conformance/csrf.json` | `make docs-check` | [x] |
| H1.2 | PHP server: mask the token in every response and accept only a masked value (HY-24); name the session cookie `__Host-hy-session` or `hy-session` (HY-45); renew the session in an action and fail a renewal in a loader (HY-72); refuse a `Cache-Control` that a shared cache may store (HY-52) | `make test-php` | [x] |
| H1.3 | Node server: the same rules as H1.2, and `FileSessions` without a cookie name option | `make test-node` | [x] |
| H1.4 | Example, browser tests, parity, feature status, deployment procedure and changelog for H1.1 to H1.3 | `make check` | [x] |

## Wave 2 — Send only the data that the templates read

Depends on: Wave 1.

| ID | Task | Verification | Status |
|---|---|---|---|
| H2.1 | Specify the read paths of a route: the paths that the layout, the title and the region templates read through their includes and blocks, the kept paths of the route regions, and `csrf` when a route region keeps a value on the server; the server sends only those paths of the shared and region data | `make docs-check` | [x] |
| H2.2 | Browser package: compute the read paths of every route from the template ASTs, with cases for variables, members, indexes, loops, assignments, includes, blocks, function arguments and operators | `make test-js` | [x] |
| H2.3 | Server build: write the read paths for the PHP server; PHP server: remove every path outside them before rendering and encoding | `make test-php` | [x] |
| H2.4 | Node server: the same removal as H2.3 from the read paths of the browser package; shared cases in `conformance/reads.json` | `make test-node` | [x] |
| H2.5 | Example, parity, browser tests, bundle size, feature status, README and changelog for H2.1 to H2.4 | `make check` | [x] |

## Wave 3 — Fail on a defect instead of continuing

Depends on: none.

| ID | Task | Verification | Status |
|---|---|---|---|
| H3.1 | Specify that a PHP warning or notice during a request, such as an undefined variable or array key, fails the request as HY-43 does | `make docs-check` | [ ] |
| H3.2 | PHP server: turn every warning and notice of a request into an exception with a failing test for each kind | `make test-php` | [ ] |
| H3.3 | Run static analysis of the PHP package at its highest level in `make check` and fix every finding | `make check` | [ ] |

## Wave 4 — Route regions of composed pages

Depends on: Wave 2.

| ID | Task | Verification | Status |
|---|---|---|---|
| H4.1 | Specify how a page that places views at request time, under one route, declares the parts that change in the browser without a request | `make docs-check` | [ ] blocked: the design needs a decision on the board list view of the board example |
