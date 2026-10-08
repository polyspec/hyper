<!-- doc-id: waves -->
# Wave background

[한국어](waves.ko.md).

Each section holds the dependencies and the background of one wave of [the execution checklist](execution-checklist.md), whose wave heading links it.

## Wave 1

Depends on: none.

## Wave 2

Depends on: Wave 1.

## Wave 3

Depends on: none.

## Wave 4

Depends on: Wave 2.

## Wave 5

Depends on: none. The browser loads every template that the templates of a route reference, transitively (HY-35). A page that selects views at request time with one route whose dispatch template references every view loads every view template on every page, also the views that it does not render.

## Wave 6

Depends on: wave 5. A page must request only the resources that it uses, each once, for templates, stylesheets and scripts alike. The asset build breaks that rule in three places. It writes the client code into one file, so an application cannot load code that only some pages use when such a page needs it. The static shell inlines `app.css`, which the rendered layout links as well, so a client-rendered page loads it twice. The build writes `public/assets/manifest.json` with the board example names `css` and `reader`, which another application does not have. The header comments of `scripts/build-assets.mjs` and `scripts/build-templates.mjs` still describe the index with referenced templates, which wave 5 removed.

## Wave 7

Depends on: none. Every checklist uses four task states: waiting, in progress, done, and bypassed with a cause and a retry condition. This checklist marked a done task with an x between the brackets and a blocked task with the waiting marker followed by `blocked: <reason>`, and no check read the states.

## Wave 8

Depends on: wave 6. Templates that style pages with Tailwind CSS use utility classes, and the asset build has no step that compiles a stylesheet with the Tailwind classes that the templates use.

## Wave 9

Depends on: none. The selection of HY-62 returns only `true` or `false`, so an application whose selection reads stored data, such as the service of the `Host` header, reads the same data again in its handlers, once in the selection and once more in a handler of the same request. The selection returns a choice with a value, and every handler of the request reads that value from its request.

## Wave 10

Depends on: H10.4 depends on template T14.2. The servers and the builds have four defects. The HY-44 check of PHP accepts an application object in loader data, which Node rejects with HY-43, so the two servers answer the same loader differently. The server build never runs the template checks of HC-6, HY-3 and HY-30, which only `make templates-check` runs on the board example, so a server program serves templates that violate them. The asset build removes the files of the previous build (`build-assets.mjs`, `template-files.mjs`) and writes its unhashed outputs into `public/`, so a server that still serves the previous build, or a page already open in a browser, loads files that are gone. Each render of a document binds the shared data again.

## Wave 11

Depends on: none. A check ran without a limit or without progress in three places. The Required checks of AGENTS asked for `make check` before a feature was marked implemented, and the task rows named `make check` as their verification, so the whole suite ran for each task. The test targets ran vitest, `node --test` and PHPUnit directly: `node --test` and PHPUnit have no per-test timeout, so a test that never settles stops the run without an end, and none of the three prints each test with its start and elapsed time. `scripts/check-parity.mjs` sends its requests with `fetch` and no timeout and prints a line only after a step ends, so a server that does not answer stops the check without naming the step.

## Wave 12

Depends on: none. Two runs from different checkouts or sessions replaced or reset a resource that another run was using. node_modules linked `@polyspec/template` to `../template/packages/template-ts`, whose build empties `dist` (tsup `clean: true`), `make template` built that package in the template repository, and Composer, PHPStan and `make ext` read the template checkout. `make parity` and `make server-parity` started their servers on the fixed ports 8092, 8094 and 8096 and accepted any server that answered there, and used the fixed databases `examples/board/var/parity*.db` and the session directory `parity-sessions`; `make e2e` used the ports 8090, 8091 and 8093 and `var/e2e.db`, `make bench-browser` the ports 8085 to 8087 and `var/bench-browser.db`. A resource of a run is isolated by the run (a port that the system assigns and that the server reports, a temporary directory); a resource that exists once has one holder at a time, recorded in a lock file that is created atomically and names the checkout, the process ID and the start time of the holder; another run fails with that holder, the holder releases the lock, and a lock whose process has ended is reported and removed by an explicit command.

## Wave 13

Depends on: none. AGENTS allows a push only when no task is `[~]`, and nothing enforced it: a push sent a tree with a task in progress, and the full suite of that tree is refused by its guard. The pre-push hook refuses such a push in every checkout that ran `make`, and the workflow `push-gate` fails for such a commit on GitHub, also for a push that skipped the hook.

## Wave 14

Depends on: none. The checks of this repository gave results that depended on the time and the machine of the run and on the state that earlier runs left. The full run of 2026-10-05 failed in 7 targets, because every target ran `make template`, which copied the working tree of `../template` while the template repository rebuilt its `dist`; npm 12.2.0 then printed `npm pack --json` as an object, so the copy failed with `TypeError: object is not iterable`. The checks of this repository have ten defect classes: results that depend on time or the outside world, tests that depend on leftover state, outputs published by removing and then writing, recipes that stop at their first failing check, failures that do not explain themselves, cases that can pass without running, leaked processes and files, assertions on tool output that varies, changed paths without owning tests, and races on shared state. Each class gets a task that fixes every instance in this repository and a rule in AGENTS.

## Wave 15

Depends on: none. Every server-rendered document of a route with a present route region embedded its data in `#hy-data`, so the source of a page showed its data next to its HTML and the HTML was larger, although a page that is only viewed never uses that data. An application now chooses per request whether a document embeds its data (HY-92), and a document embeds none by default; the browser requests the document JSON of the page once when it first needs the data (HY-93). The server rules of the protocol also have a Python implementation, the package `packages/hyper-python`, which renders with the template Python package and serves the board example over `http.server` (H15.3).

## Wave 16

Depends on: none. The scripts that gate pushes, run the full suite, check documents, select owner checks, run tests, report CI, check toolchains, release and review dependencies existed as copies in several polyspec repositories and differed between them. They now come from the shared tool repository `polyspec/kit`: this repository holds the byte-for-byte copy `scripts/kit/` and `tests/kit/` of the tag `v0.0.9` (`kit.json`, `.kit/kit.lock.json`) and differs from the other repositories only in `config/*.json`. Until version 0.1 a change is checked by its owning unit test and pushed to `main` once, when every task is done; the push of `main` runs the CI group jobs, and a release tag is set only after the check `ci-passed` of that CI run succeeded.
