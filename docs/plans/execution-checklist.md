# Execution checklist

[한국어](execution-checklist.ko.md).

This document lists the planned tasks of hyper, the verification command of each task and its completion. The rules are in [the protocol](../spec/protocol.md), the status of each feature in [Feature status](../features.md) and the actual changes in [the changelog](../../CHANGELOG.md).

## How to use

- Task ID format: `H<wave>.<number>`.
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

Depends on: none. Every checklist uses four task states: waiting, in progress, done, and bypassed with a cause and a retry condition. This checklist marked a done task with an x between the brackets and a blocked task with the waiting marker followed by `blocked: <reason>`, and no check read the states.

| ID | Task | Verification | Status |
|---|---|---|---|
| H7.1 | Accept only the four task states in `scripts/check-documents.mjs`, the same in both languages, with the cause and the retry condition of a bypassed task; check it fails on the rows marked with an x; write every done task with the done marker; state the checklist rules in AGENTS | `make docs-check` | [o] |
| H7.2 | State in AGENTS the commit message format `type(scope): Subject (#task)` with a body wrapped at 72 characters, that work may be done on `main`, the names of branches and worktrees and their removal after the merge, the removal of test code that cannot be merged, and the classification of a received instruction with the agent memory | `make docs-check` | [o] |
| H7.1-1 | Allow a task state marker in this checklist only as the state of a task row, at the start of its last cell: the legend of How to use and the texts of wave 7, H7.1, H11.1 and H11.1-1 wrote markers in inline code, and `scripts/check-documents.mjs` read only the last cell of each task row, so a tool that counted markers counted tasks in progress that do not exist. AGENTS defines the states; remove the legend, name states in words in the texts, and make `make docs-check` fail for every other marker with its file, line and column, without exceptions; a case of `tests/scripts/check-documents.test.mjs` that fails before the change. Red: the fixture of the test holds markers in a legend, in inline code of a task, in the cause of a bypassed task and in the last cell of a row that is not a task; the former check printed `2 documents, 0 problem(s)` for it. Green: the 2 cases pass, the fixture failing with the 5 locations of each language; with the check and the former texts, `make docs-check` failed with 28 problems on lines 10, 81, 85, 128 and 131 of each language, and it passes after the change | `make docs-check`, `node scripts/run-tests.mjs node -- tests/scripts/check-documents.test.mjs` | [o] |
| H7.1-1-1 | Treat the task list states of GitHub as state markers: H7.1-1 checks only the four states of this repository, while a Markdown reader also takes an x or a capital X between brackets as the state of a task list item, so such a marker outside a task state passed `make docs-check`; make the check fail for it with its file, line and column, with cases in `tests/scripts/check-documents.test.mjs` that fail before the change | `make docs-check`, `node scripts/run-tests.mjs node -- tests/scripts/check-documents.test.mjs` | [~] |

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
| H9.1 | Specify in HY-62: the selection returns a choice, whether the request is of a client-rendered page and a value; every loader and action of the request reads the value from its request, and a request of an application without the declaration has the value null | `make docs-check` | [o] |
| H9.2 | PHP and Node servers: `Choice`, `Request::selection()` and `request.selection()`, with tests that fail before the change; documents, feature status and changelog | `make check` | [o] |

## Wave 10 — One data model check and add-only build outputs

Depends on: H10.4 depends on template T14.2. The servers and the builds have four defects. The HY-44 check of PHP accepts an application object in loader data, which Node rejects with HY-43, so the two servers answer the same loader differently. The server build never runs the template checks of HC-6, HY-3 and HY-30, which only `make templates-check` runs on the board example, so a server program serves templates that violate them. The asset build removes the files of the previous build (`build-assets.mjs`, `template-files.mjs`) and writes its unhashed outputs into `public/`, so a server that still serves the previous build, or a page already open in a browser, loads files that are gone. Each render of a document binds the shared data again.

| ID | Task | Verification | Status |
|---|---|---|---|
| H10.1 | HY-44: a native object (VAL-19) in the host binding of loader and shared handler values fails with HY-43, and values that binding turns into data model values (PHP `stdClass`, `JsonSerializable`) pass; cases that fail before the change on PHP | `make check` | [o] |
| H10.2 | Move the checks of `check-templates.mjs` into one function of a manifest and a template directory, used by `make templates-check` and by `build-server.mjs` before it writes anything; HY-48 states that a violation writes nothing; a case that fails before the change | `make check` | [o] |
| H10.2-1 | Make the template rules see placements and includes inside the branches of a condition: the walk skipped node lists inside objects without a type, so a route region placed through `{? }` branches counted 0 times; move the rules into `templateProblems` of `scripts/template-rules.mjs` for the server build; a fixture route with a region placed in a branch and one placed through an include in a branch | `make check` | [o] |
| H10.3 | The asset build only adds files whose names hold a content hash and writes its unhashed outputs (`manifest.json`, `templates.index.json`) into the directory of `--output` (HY-34, HY-76); a build test that fails before the change | `make check` | [o] |
| H10.3-1 | Make `tests/package-install` expect the export `./templates-index` of `@polyspec/hyper` that H10.3 added: the package install test required the export `.` alone, so `make package-check` failed on main | `make package-check` | [o] |
| H10.4 | Bind each pruned root once per document with the bound value of template T14.2 and use it in every render, so a value is checked at most twice whatever the number of renders; JSON responses bind only `params` again | `make check` | [o] |
| H10.5 | Call the host binding of the template package by its name `bindValue` in the browser and Node packages: template T14.2 renamed the TypeScript host binding `bind` to `bindValue` and gave `bind` to the bound map, so `tsc` of `packages/hyper-js` failed with `BoundMap is not assignable to Value` against template main | `make check` | [o] |
| H10.6 | Measure the gzip limits of the SSR script and the CSR shell again by the rule of the development guide (measured size plus about 1 %, rounded up to 100 bytes): 33,500 and 33,600 for 33,080 and 33,224 gzip bytes. Since 2026-10-04 the SSR script grew by 441 gzip bytes and the CSR shell by 442, because the bundle took code that its renders call: the bound map runtime of template T14.2 (`bind`, `merge`, `BoundMap`, the bound map cases of `bindValue`, `bindMap` and `bindData`), 982 minified bytes; the root binding of H10.4 in `response.ts` (`bindParts`, `renderRegionOf`), 341; the rename of H10.5, 13. The SSR limit 32,700 did not follow the rule, which gave 33,000 for 32,639 bytes; this change corrects it | `make bundle-size` | [o] |

## Wave 11 — Bounded test runs that print their progress

Depends on: none. A check ran without a limit or without progress in three places. The Required checks of AGENTS asked for `make check` before a feature was marked implemented, and the task rows named `make check` as their verification, so the whole suite ran for each task. The test targets ran vitest, `node --test` and PHPUnit directly: `node --test` and PHPUnit have no per-test timeout, so a test that never settles stops the run without an end, and none of the three prints each test with its start and elapsed time. `scripts/check-parity.mjs` sends its requests with `fetch` and no timeout and prints a line only after a step ends, so a server that does not answer stops the check without naming the step.

| ID | Task | Verification | Status |
|---|---|---|---|
| H11.1 | Required checks of AGENTS: before a commit the Red and Green tests that own the change and `make docs-check`; a task becomes done with the command that owns it, which its Verification column names; `make check` runs once, when every active task is done | `make docs-check` | [o] |
| H11.2 | Run vitest, `node --test` and PHPUnit through `scripts/run-tests.mjs` and its progress reporters: every test prints its start, its result and its elapsed time and fails by its name at its own timeout; `make test-js`, `test-node`, `test-php`, `test-scripts` and `package-check` use it; the runner has its own tests | `node scripts/run-tests.mjs node -- tests/scripts/run-tests.test.mjs` | [o] |
| H11.3 | `scripts/check-parity.mjs` gives every request a timeout with `AbortSignal.timeout`, prints a line when a step starts and the elapsed milliseconds with its result, and fails by the step name when a server does not answer; a test against a server that does not answer | `node scripts/run-tests.mjs node -- tests/scripts/check-parity.test.mjs` | [o] |
| H11.1-1 | Enforce the single full run with the guard `scripts/full-run.mjs`, which `make check` starts before any step: it refuses while a task row of this checklist is in progress and lists each active ID with its task, refuses while tracked changes are uncommitted, refuses a second full run of the same tree (`git rev-parse HEAD^{tree}`) and names the earlier run, runs each target of `CHECK_TARGETS` with `make <target>` to its end and writes `var/full-run.json` (tree, commit, result, each target with its status and times) before and after each target, so a stopped run stays `incomplete`; `make rerun-failed` reruns only the targets of the current tree that did not pass and completes the result when they pass. Cause: AGENTS states that `make check` runs exactly once, when every active task is done, and nothing enforced it: a run with a task in progress, a run of uncommitted changes and a second run of the same tree all started the suite. Red: `make -n check` printed the first step of `template-check`, so the suite started whatever the checklist held, `make -n rerun-failed` failed with `No rule to make target`, and `tests/scripts/full-run.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `scripts/full-run.mjs`. Green: its 10 cases pass: `make -n check` prints only the guard, a fixture checklist with a task in progress, a dirty tree, a second run of one tree and `rerun-failed` without a record are refused before any stub target runs, and `rerun-failed` runs only the stub targets that failed or did not finish | `node scripts/run-tests.mjs node -- tests/scripts/full-run.test.mjs` | [o] |

## Wave 12 — Test resources of one run

Depends on: none. Two runs from different checkouts or sessions replaced or reset a resource that another run was using. node_modules linked `@polyspec/template` to `../template/packages/template-ts`, whose build empties `dist` (tsup `clean: true`), `make template` built that package in the template repository, and Composer, PHPStan and `make ext` read the template checkout. `make parity` and `make server-parity` started their servers on the fixed ports 8092, 8094 and 8096 and accepted any server that answered there, and used the fixed databases `examples/board/var/parity*.db` and the session directory `parity-sessions`; `make e2e` used the ports 8090, 8091 and 8093 and `var/e2e.db`, `make bench-browser` the ports 8085 to 8087 and `var/bench-browser.db`. A resource of a run is isolated by the run (a port that the system assigns and that the server reports, a temporary directory); a resource that exists once has one holder at a time, recorded in a lock file that is created atomically and names the checkout, the process ID and the start time of the holder; another run fails with that holder, the holder releases the lock, and a lock whose process has ended is reported and removed by an explicit command.

| ID | Task | Verification | Status |
|---|---|---|---|
| H12.1 | HY-78: read the template repository only through the declared copy `var/products/template` that `scripts/copy-template.mjs` writes (`npm pack` of the built TypeScript package, tracked files of the PHP package, the native extension, the Rust crate and the compiler); npm installs a copy, Composer, PHPStan and `make ext` read the copy, and `make template` builds nothing in the template repository | `node scripts/run-tests.mjs node -- tests/scripts/template-copy.test.mjs` | [o] |
| H12.2 | `scripts/check-parity.mjs` starts the PHP server and the board Node server with `scripts/board-servers.mjs` on ports that the system assigns, sends its requests to the address that each server reports in its output, prints that output with the prefix of the server, and keeps the databases and the session directory in a temporary directory of the run; the options `--port` and `--node-port` and the polling `waitForServer` are removed | `node scripts/run-tests.mjs node -- tests/scripts/check-parity.test.mjs` | [o] |
| H12.3 | `make e2e` runs `scripts/run-e2e.mjs`, which starts the board example with `scripts/board-servers.mjs` on ports that the system assigns and an empty database in a temporary directory of the run, and runs Playwright with the addresses in `HYPER_E2E_SSR` and `HYPER_E2E_CSR`; `playwright.config.ts` has no `webServer` and no ports, and `examples/board/var/e2e.db` is not used | `node scripts/run-tests.mjs node -- tests/scripts/run-e2e.test.mjs` | [o] |
| H12.4 | `make serve-demo` keeps its fixed ports 8080 to 8082 and holds the lock `/tmp/hyper-serve-demo.lock` of `scripts/holder-lock.mjs`, which names the checkout, the process ID and the start time of the demo: a second demo fails with that holder, the demo releases the lock when it stops, and a lock of an ended demo is reported and removed by `make serve-demo-unlock`; `make bench-browser` starts its servers with `scripts/board-servers.mjs` on ports that the system assigns and its database in a temporary directory of the run | `node scripts/run-tests.mjs node -- tests/scripts/serve-demo.test.mjs` | [o] |
| H12.5 | Run PHPStan of `make analyse-php` with `--memory-limit=256M`: without its result cache `build/phpstan`, as in a new worktree, the worker needs 132 MB and crashed at the default PHP limit of 128M, so `make check` failed in `analyse-php` | `rm -rf build/phpstan && make analyse-php` | [o] |
| H12.6 | HY-79: no symbolic link below `node_modules` or `vendor`. npm installs every dependency as a copy and no bin link (`.npmrc`), the root package declares the packages of this repository instead of npm workspaces, which npm always links, `make packages` reinstalls the copies after the build, the recipes start the tools with the files of their packages, and Composer installs `polyspec/hyper` in the board from the tracked-file copy `var/products/hyper-php`; `tests/scripts/no-symlinks.test.mjs` fails on any symbolic link | `node scripts/run-tests.mjs node -- tests/scripts/no-symlinks.test.mjs` | [o] |
| H12.6-1 | Give each npm package a declared build that runs the TypeScript compiler by the path of its package: H12.6 removed the bin links, so `npm exec --offline --no -- tsc` in `packages/hyper-js` found no command (`This is not the tsc command you are looking for`), and H12.6 was reverted. `scripts/tsc.mjs` resolves `typescript/package.json` and runs its `bin.tsc` with the arguments of the call; `npm run build` (`tsconfig.build.json`) and `npm run tsc -- <arguments>` of each package and `TSC` of the Makefile use it. H12.6 lands again with this task | `node scripts/run-tests.mjs node -- tests/scripts/package-build.test.mjs` | [o] |
