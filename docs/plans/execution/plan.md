<!-- doc-id: plan-execution -->
# Execution

[한국어](plan.ko.md).

Each section holds the dependencies and the background of one wave of [the execution checklist](checklist.md).

## Wave 1 — CSRF protection that an application cannot weaken

Depends on: none.

## Wave 2 — Send only the data that the templates read

Depends on: Wave 1.

## Wave 3 — Fail on a defect instead of continuing

Depends on: none.

## Wave 4 — Route regions of composed pages

Depends on: Wave 2.

## Wave 5 — Load only the templates that rendering reaches

Depends on: none. The browser loads every template that the templates of a route reference, transitively (HY-35). A page that selects views at request time with one route whose dispatch template references every view loads every view template on every page, also the views that it does not render.

## Wave 6 — Request only the resources that a page uses

Depends on: wave 5. A page must request only the resources that it uses, each once, for templates, stylesheets and scripts alike. The asset build breaks that rule in three places. It writes the client code into one file, so an application cannot load code that only some pages use when such a page needs it. The static shell inlines `app.css`, which the rendered layout links as well, so a client-rendered page loads it twice. The build writes `public/assets/manifest.json` with the board example names `css` and `reader`, which another application does not have. The header comments of `scripts/build-assets.mjs` and `scripts/build-templates.mjs` still describe the index with referenced templates, which wave 5 removed.

## Wave 7 — Four task states

Depends on: none. Every checklist uses four task states: waiting, in progress, done, and bypassed with a cause and a retry condition. This checklist marked a done task with an x between the brackets and a blocked task with the waiting marker followed by `blocked: <reason>`, and no check read the states.

## Wave 8 — Tailwind CSS in the asset build

Depends on: wave 6. Templates that style pages with Tailwind CSS use utility classes, and the asset build has no step that compiles a stylesheet with the Tailwind classes that the templates use.

## Wave 9 — The value of the client rendering selection reaches the handlers

Depends on: none. The selection of HY-62 returns only `true` or `false`, so an application whose selection reads stored data, such as the service of the `Host` header, reads the same data again in its handlers, once in the selection and once more in a handler of the same request. The selection returns a choice with a value, and every handler of the request reads that value from its request.

## Wave 10 — One data model check and add-only build outputs

Depends on: H10.4 depends on template T14.2. The servers and the builds have four defects. The HY-44 check of PHP accepts an application object in loader data, which Node rejects with HY-43, so the two servers answer the same loader differently. The server build never runs the template checks of HC-6, HY-3 and HY-30, which only `make templates-check` runs on the board example, so a server program serves templates that violate them. The asset build removes the files of the previous build (`build-assets.mjs`, `template-files.mjs`) and writes its unhashed outputs into `public/`, so a server that still serves the previous build, or a page already open in a browser, loads files that are gone. Each render of a document binds the shared data again.

## Wave 11 — Bounded test runs that print their progress

Depends on: none. A check ran without a limit or without progress in three places. The Required checks of AGENTS asked for `make check` before a feature was marked implemented, and the task rows named `make check` as their verification, so the whole suite ran for each task. The test targets ran vitest, `node --test` and PHPUnit directly: `node --test` and PHPUnit have no per-test timeout, so a test that never settles stops the run without an end, and none of the three prints each test with its start and elapsed time. `scripts/check-parity.mjs` sends its requests with `fetch` and no timeout and prints a line only after a step ends, so a server that does not answer stops the check without naming the step.

## Wave 12 — Test resources of one run

Depends on: none. Two runs from different checkouts or sessions replaced or reset a resource that another run was using. node_modules linked `@polyspec/template` to `../template/packages/template-ts`, whose build empties `dist` (tsup `clean: true`), `make template` built that package in the template repository, and Composer, PHPStan and `make ext` read the template checkout. `make parity` and `make server-parity` started their servers on the fixed ports 8092, 8094 and 8096 and accepted any server that answered there, and used the fixed databases `examples/board/var/parity*.db` and the session directory `parity-sessions`; `make e2e` used the ports 8090, 8091 and 8093 and `var/e2e.db`, `make bench-browser` the ports 8085 to 8087 and `var/bench-browser.db`. A resource of a run is isolated by the run (a port that the system assigns and that the server reports, a temporary directory); a resource that exists once has one holder at a time, recorded in a lock file that is created atomically and names the checkout, the process ID and the start time of the holder; another run fails with that holder, the holder releases the lock, and a lock whose process has ended is reported and removed by an explicit command.

## Wave 13 — A push without a task in progress

Depends on: none. AGENTS allows a push only when no task is `[~]`, and nothing enforced it: a push sent a tree with a task in progress, and the full suite of that tree is refused by its guard. The pre-push hook refuses such a push in every checkout that ran `make`, and the workflow `push-gate` fails for such a commit on GitHub, also for a push that skipped the hook.

## Wave 14 — Results that depend only on the tree

Depends on: none. The checks of this repository gave results that depended on the time and the machine of the run and on the state that earlier runs left. The full run of 2026-10-05 failed in 7 targets, because every target ran `make template`, which copied the working tree of `../template` while the template repository rebuilt its `dist`; npm 12.2.0 then printed `npm pack --json` as an object, so the copy failed with `TypeError: object is not iterable`. The checks of this repository have ten defect classes: results that depend on time or the outside world, tests that depend on leftover state, outputs published by removing and then writing, recipes that stop at their first failing check, failures that do not explain themselves, cases that can pass without running, leaked processes and files, assertions on tool output that varies, changed paths without owning tests, and races on shared state. Each class gets a task that fixes every instance in this repository and a rule in AGENTS.

## Wave 15 — A document embeds its data only when the application asks for it

Depends on: none. Every server-rendered document of a route with a present route region embedded its data in `#hy-data`, so the source of a page showed its data next to its HTML and the HTML was larger, although a page that is only viewed never uses that data. An application now chooses per request whether a document embeds its data (HY-92), and a document embeds none by default; the browser requests the document JSON of the page once when it first needs the data (HY-93). The server rules of the protocol also have a Python implementation, the package `packages/hyper-python`, which renders with the template Python package and serves the board example over `http.server` (H15.3).

## Wave 16 — Shared tools from polyspec/kit

Depends on: none. The scripts that gate pushes, run the full suite, check documents, select owner checks, run tests, report CI, check toolchains, release and review dependencies existed as copies in several polyspec repositories and differed between them. They now come from the shared tool repository `polyspec/kit`: this repository holds the byte-for-byte copy `scripts/kit/` and `tests/kit/` of the tag `v0.0.9` (`kit.json`, `.kit/kit.lock.json`) and differs from the other repositories only in `config/*.json`. Until version 0.1 a change is checked by its owning unit test and pushed to `main` once, when every task is done; the push of `main` runs the CI group jobs, and a release tag is set only after the check `ci-passed` of that CI run succeeded.

## Wave 17 — Releases 0.0.5 and 0.0.6

Depends on: wave 16. The release 0.0.5 sets the version 0.0.5 in every manifest that `config/release.json` lists, with the template pins of the release v0.0.5 and the Python package consumed by git tag. The release 0.0.6 sets the version 0.0.6 in the same manifests and keeps the template pins of the release v0.0.5.

## Wave 18 — Package names that state the role

Depends on: wave 17. The same name `polyspec/hyper` named the browser package on npm and the PHP server on Composer, and the directories `hyper-js` and `hyper-node` differed from the package names. Every package name now states its role, client, server or build, and every directory below `packages/` states the role and the language of a server, so a release archive name states the role and the registry of its package. The release 0.0.7 publishes the packages with these names. The release 0.0.8 gives the Python server the write hook.

## Wave 19 — Server callables that a production server runs

Depends on: wave 18. The Python server served an application over `http.server`, which the Python documentation marks as not recommended for production, whatever fronts it, as `php -S` is for PHP; an application could not run under a server that a project recommends for production. The pipeline of the server — the public files, the body limit, the request hook `around` (HY-97), the session cookie of a new session (HY-45), the write hook `written` (HY-99) and the disconnect hook on a failed write (HY-67) — now stands also as a WSGI application callable and as an ASGI application callable. The library names no server and takes no dependency on one: a deployment runs the callable with the server that it chooses. The release 0.0.9 publishes the callables.

## Wave 20 — The write hook of every server and the plain 500 of an escaped error

Depends on: wave 19. An error that escapes the answer of a request reached the consumers in a different way in each adapter: PHP reported its plain 500 to the response hook, Node and the Python `create_server` wrote it without a hook, and the WSGI and ASGI callables let the error propagate to their server. The write hook `written` existed only for the Python `create_server` and for the events of the Node response, so a consumer could not record the response of a PHP request. HY-99 now gives every server one write hook with the same values, HY-102 gives the Node server a listener for an application, and HY-60 states that the plain 500 of an escaped error keeps the headers that the caller set before hyper received the request.

## Wave 21 — A reply that sets the Referrer-Policy header

Depends on: wave 20. A page sends its address in the Referer header to the sites that it links to, as the policy of the page allows. The reply had no method for the Referrer-Policy header, so an application could not limit that header, and a general header setter would bypass the rules that hyper keeps for the headers of a page, such as Cache-Control, the frame policy and the cookies. The reply gets the named method `referrerPolicy` in each adapter (HY-103), which accepts only the tokens of the Referrer-Policy specification.

## Wave 22 — Outside tools used as they are

Depends on: wave 21. The rules of `AGENTS.md` read as if the path and symbolic link rules covered the links and paths that outside tools create, so a change could be read as requiring this repository to rebuild a standard tool of its ecosystem, such as uv for Python environments and locks. The rules now state that an existing outside tool or library is used as it is, with its own behavior, and that the path and symbolic link rules govern what this repository creates.

## Wave 23 — The shared tools as the npm package @polyspec/kit

Depends on: wave 22. The shared tools were a vendored copy of the tag of the kit repository in `scripts/kit` and `tests/kit`, and npm installed every dependency as a copy and without bin links, which forced `scripts/tsc.mjs` and the copies of the npm packages in `node_modules`. kit is now the npm package `@polyspec/kit`: this repository installs it from the asset of its release, holds only the files of `kit.copies` as copies, and declares the toolchain floors that kit pins. npm installs with its own defaults: the npm packages of this repository are npm workspaces and the tools run through the bin links of npm.

## Wave 24 — Session files that several processes write

Depends on: wave 23. Two processes that wrote one session file at the same time failed. The Python and the Node session stores wrote each write of a session to one temporary file `<id>.tmp` and renamed it into place; when two processes overlapped, the rename of one found the temporary file already moved by the other and raised `FileNotFoundError`. Each write now creates its own temporary file and renames it (HY-104).

## Wave 27 — Release readiness after linked development

Depends on: the completed development rows. H27.1 audits earlier decisions; H27.2 resolves the PHP dependency graph before H27.3 builds and verifies the candidate. H26.9 remains a separate measurement task.

A terminal checklist state does not establish release readiness. The four withdrawn rows describe decisions made during local development; each release obligation is judged separately. PHP 8.4 remains the runtime target. A source link proves neither the compatibility of a published dependency nor a clean archive installation.

| Earlier item | Release disposition | Evidence still required |
|---|---|---|
| H25.66 | Keep the obsolete version-update task withdrawn; revisit PHPUnit selection in H27.2 through Composer under the PHP 8.4 platform. The recorded candidate 13.4.3 is not a current compatibility or version-selection result. | Native Composer resolution, valid locks and platform checks. |
| H25.71 | Keep the preserveSymlinks implementation withdrawn. A direct source link uses the provider's dependency resolution; the release must also build from its installed archives, which H27.3 verifies. | Clean release-consumer installation and successful build bins, without development links. |
| H25.73 | Keep the historical row withdrawn and restore its release lock-consistency obligation in H27.2. Development's retained release records do not exempt the next release from valid manifests and locks. | composer validate --strict for the root and board projects. |
| H26.8 | Keep the development lock rewrite withdrawn; H27.2 selects actual dependency releases supporting PHP 8.4 and regenerates the release records through Composer. PHP is not raised to match old PHP 8.5 records. | Composer platform checks of both locks under PHP 8.4, with no platform requirement ignored. |
| H26.9 | Keep the measurement open. PHP 8.4 extension preparation does not complete an idle-machine benchmark. | The complete make bench output, idle-machine conditions and updated English and Korean results. |

The next patch candidate is 0.0.19, following 0.0.18. H27.3 prepares the version, archives and consumer locks with the declared release targets and verifies their installation. No tag is created or pushed by these tasks. The private root's own package path repository remains Composer-managed; a sibling source override is not evidence that a released dependency supports PHP 8.4.

After the active checklist work is complete, run the final full verification once, then only the owning checks of any failures. The release commit must have successful CI evidence, including ci-passed. The existing full-run record from PHP 8.5 and a different tree does not prove this candidate. Only the maintainer creates or pushes the release tag after the release checks pass.

H27.25 prepares independently owned CI environments using native package managers and the shared selective tool interface. The pinned kit 0.0.61 provides the selective installer. Verify the application declarations, scoped toolchain validation, explicit PHP symbol extractors and owner checks in an isolated worktree, then land and push once to collect CI evidence. No application-specific tool installer is added.

H27.26 keeps the 0.0.21 candidate unpublished until every runtime test uses the provider runner. Python now uses the supported Kit interface and the private unittest harness is removed. Browser E2E still requires a native Playwright adapter, requested in [Kit issue 13](https://github.com/polyspec/kit/issues/13); retain every browser case and await the provider implementation rather than wrapping the suite as one synthetic test or weakening release checks. No release tag or new CI run is created while that execution path remains direct.

The pinned 0.0.63 corrects clean-checkout bootstrap and runtime-scoped native linking. It still has no Playwright runner adapter, so H27.26 remains active and the 0.0.21 candidate has no release tag. The upstream issue retains the per-case reporting, empty-selection, deadline and process-cleanup acceptance conditions.
