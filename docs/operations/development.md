# Development

[한국어](development.ko.md).

## Toolchain

- The pinned toolchain (HY-81): Node.js of `.node-version`, PHP of the minor of `config/toolchain.json` with `pdo_sqlite`, GNU Make 3.81 or later, and rustup. `make install` installs npm of `packageManager` and Composer of `config/toolchain.json` into `var/tools` (`make tools`), and `make install-rust` the Rust toolchain of the template copy; `make toolchain-check` names every tool that differs from its pin.
- The template repository at `../template` (`TEMPLATE_REPOSITORY`), with the branch that `config/template.json` names (HY-80) and a build of the TypeScript package of its head commit, which `make build-ts` of the template repository makes; the copy fails with the expected and the actual branch or input hash otherwise. This repository builds nothing there: `make template` copies it into `var/products/template` (HY-78), and the browser code imports the TypeScript package from that copy.
- Rust: the toolchain of `rust-toolchain.toml` of the template branch, with which `make ext` builds; cargo installs no toolchain (`RUSTUP_AUTO_INSTALL=0`).
- The network: only `make tools`, `make install`, `make install-rust` and `make install-browser` download. Every other recipe runs cargo, npm and Composer offline (`CARGO_NET_OFFLINE`, `npm_config_offline`, `COMPOSER_DISABLE_NETWORK`), so a missing download fails at once and names the install target that makes it (HY-89).
- Chromium for Playwright: `make install-browser`, which installs the Chromium of the pinned Playwright and, on Linux, its system libraries.

## Targets

| Target | Action |
|---|---|
| `make tools` | Installs npm of `packageManager` and Composer of `config/toolchain.json` into `var/tools` and writes the commands of `var/tools/bin`, verifying each download by its pinned digest (HY-81) |
| `make toolchain-check` | Fails when Node.js, npm, Composer or the PHP minor differs from its pin and names the expected and the actual value of each (HY-81) |
| `make install` | Writes the declared copy of the template repository and the copy of `packages/hyper-php`, and installs npm and Composer dependencies as copies without bin links (HY-79) |
| `make install-rust` | Installs the Rust toolchain of the declared copy and downloads the crates of the native extension, which `make ext` needs (HY-89) |
| `make hyper-php-copy` | Writes the copy `var/products/hyper-php` of the tracked files of `packages/hyper-php` and publishes it into the Composer copy of the board (HY-79, HY-82); `make server` runs it first |
| `make template` | Writes the declared copy `var/products/template` of the template branch with `scripts/copy-template.mjs` and publishes the npm copy of the TypeScript template package and the Composer copies of the PHP template package from it file by file (HY-78, HY-80, HY-82); it does so only when `config/template.json` or the copy script is newer than `var/products/template/installed.stamp`. Tests, assets and server builds run it first |
| `make template-check` | Fails when the npm copy of the TypeScript template package or a Composer copy of the PHP template package differs from the declared copy |
| `make rust-downloads-check` | Fails when the Rust toolchain or a crate of the native extension of the declared copy is missing, with the first error line of cargo and `run make install-rust` (HY-89) |
| `make ext` | Builds the native template extension of the declared copy of the template repository offline into `build/ext` after `make rust-downloads-check` (HY-48, HY-78, HY-89) |
| `make packages` | Builds the JavaScript modules and type declarations of `@polyspec/hyper` and `@polyspec/hyper-server` into their `dist` directories with the declared build of each package (`npm run build`, which runs `scripts/tsc.mjs`) and publishes the build and the npm copy of each file by file (HY-79, HY-82); the Node server tests, the board asset build, `make package-check` and `make test-scripts` run it first, because they import the packages through their exports (HY-61). The build scripts read `data-template.json`, `checkManifest` and `templateReferences` from the source of `packages/hyper-js` next to them, so they do not need `dist` and run from any working directory |
| `make package-check` | Installs both packages into `tests/package-install` offline from its `package-lock.json` with `npm ci --offline --install-links` (HY-89), type-checks its test against their declarations with `erasableSyntaxOnly` and runs it under `node` (HY-61) |
| `make server` | Builds the board server program into `examples/board/build/server` (see below) |
| `make server-fixtures` | Builds the server program of the PHP test fixtures |
| `make node-fixtures` | Builds the template files of the PHP test fixtures for the Node server tests with `scripts/build-templates.mjs` and the declared copy of the template repository (HY-70, HY-78) |
| `make node-server` | Type-checks and bundles the board Node server into `examples/board/build/node/server.mjs` (see below) |
| `make assets` | Builds the board client bundle and the CSR shell (see below) |
| `make test-js` | Runs the browser code tests, including the router conformance cases, and the type check |
| `make test-node` | Runs the Node server tests: the cases of the PHP server tests against the same fixtures, the JSON cases of `conformance/json.json`, sessions, the HTTP server, and the type check |
| `make test-php` | Runs the server package tests, including the router conformance cases, once with the generated program and once with the native extension |
| `make lint` | Checks PHP formatting |
| `make analyse-php` | Runs PHPStan at level `max` on the source and the tests of `packages/hyper-php` with `packages/hyper-php/phpstan.neon`, without a baseline and without ignored errors. PHPStan reads the signatures of the native template extension from `var/products/template/packages/template-php-ext/stubs/polyspec_template.stub.php` (HY-78) and writes its cache to `build/phpstan`. It runs with `--memory-limit=256M`, because a run without that cache needs 132 MB in its worker, above the default PHP limit of 128M |
| `make templates-check` | Checks that only the layout template carries `hx-` attributes (HC-6), that the layout places `{# title}` and `{# data}` once, and that every region of the layout and of each route template is placed once, directly inside an element whose `id` is the region name, without block arguments (HY-3, HY-30) |
| `make test-scripts` | Runs the tests of the check scripts, such as the region placement check with a broken fixture application |
| `make parity` | Compares PHP documents with browser renders of document and region JSON, once with the generated program and once with the native extension |
| `make server-parity` | Runs the parity steps against the PHP server and the board Node server and compares the status, the headers and the body of every response, with the browser comparison of `make parity` (HY-55) |
| `make bundle-size` | Prints the SSR script and CSR shell sizes and enforces the gzip limits in `config/bundle-size.json` |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers and a database of the run (`scripts/run-e2e.mjs`) |
| `make owner-check` | Runs the owners of the changed paths that `scripts/owner-checks.json` declares, after it checks that every tracked path has an owner; `PATHS` names the paths and `BASE` takes the changes since a revision (HY-88) |
| `make docs-check` | Runs `make hooks-check`, then checks document pairs, links and code blocks |
| `make hooks` | Sets `core.hooksPath` to `.githooks` and runs `make hooks-check` (see [Push](#push)) |
| `make hooks-check` | Fails while `core.hooksPath` is not `.githooks` or `.githooks/pre-push` is missing or not executable |
| `make push-gate-commit` | Fails when the commit `COMMIT` has a checklist task in progress or does not track `.githooks/pre-push` with mode 100755; the job `push-gate` of GitHub runs it (see [Push](#push)) |
| `make ci-pins` | Prints the PHP minor of `config/toolchain.json` and the template branch of `config/template.json` and gives them to the workflow as step outputs (see [CI](#ci)) |
| `make ci-check` | Runs the targets of the CI group `GROUP` to their ends and writes the report `var/ci/<group>/`; only under GitHub Actions (see [CI](#ci)) |
| `make ci-summary` | Writes the summary of the CI group `GROUP` into its report and the job summary (see [CI](#ci)) |
| `make install-browser` | Installs the Chromium of the pinned Playwright and, on Linux, its system libraries; a download through `$(ONLINE)` (HY-89) |
| `make serve-demo` | Serves SSR, CSR and the comparison page on the fixed ports 8080 to 8082 while it holds the lock `/tmp/hyper-serve-demo.lock`; a second demo fails with the holder (see [Deployment](deployment.md)) |
| `make serve-demo-unlock` | Removes the lock of a demo whose process has ended; fails while the demo runs |
| `make bench-server-smoke` | Runs the PHP benchmark once per measurement; `make check` includes it so that a change that breaks the benchmark fails |
| `make bench` | Runs `make bench-server` and `make bench-browser`, which report server and browser performance (see [Benchmark](benchmark.md)); they are not part of `make check` |
| `make check` | Runs every check above through the guard of the full run (see below) |
| `make rerun-failed` | Reruns only the targets of `make check` that did not pass on the current tree (see below) |

## Full run

`make check` runs once per committed tree, when no task of `docs/plans/execution-checklist.md` is `[~]`. Before any step it starts `scripts/full-run.mjs`, which prints its decision with the reason (`[full-run] run: ...` or `[full-run] refuse: ...`) and refuses with status 1:

- while a task row of the checklist is `[~]`; the refusal lists each active ID with its task;
- while tracked files have uncommitted changes (`git status --porcelain --untracked-files=no`), because a full run verifies a committed tree;
- when `var/full-run.json` records a full run of the current tree (`git rev-parse HEAD^{tree}`); the refusal names that run with its commit, its start time and its result;
- while the pre-push hook is not installed (`make hooks-check`); the refusal names `make hooks`;
- while the process of an `incomplete` record still runs.

The guard runs each target of `CHECK_TARGETS` with `make <target>` to its end, also after a target fails, and prints `[full-run] start <target> (<n>/<total>)` and `[full-run] <target> passed|failed in <seconds> s`; no target has a time limit. It writes `var/full-run.json` before and after each target: the tree, the commit, the process, the start and end times, the result (`incomplete` until the last target ends, then `passed` or `failed`), the failed targets and each target with its status (`pending`, `running`, `passed`, `failed`), its times and its elapsed milliseconds, and for a failed target its last 20 output lines (`lastLines`), which the guard also prints with the failed target before the result (HY-84). A run that is stopped therefore stays recorded as `incomplete`, with the target that was running. `var/` is ignored by Git, so each checkout and worktree has its own record. A commit that changes the tree permits a new full run when no task is `[~]`.

`make rerun-failed` reruns only the targets of the current tree that did not pass: the failed targets and the targets that an `incomplete` run did not finish. It is refused like `make check` for a task in progress, uncommitted changes and a running process, and also when there is no record, when the record belongs to another tree and when the full run of the tree passed. It writes each rerun into `reruns` of the record; when every target has passed, the result of the tree becomes `passed`.

A new checkout has no record, so `make check` runs there when no task is `[~]` and the tree is clean.

## Push

A push happens only when no task of the checklist is `[~]`, neither in a pushed commit nor in the working tree. The tracked pre-push hook `.githooks/pre-push` runs `node scripts/push-gate.mjs hook`, which reads the refs of the push from its input, parses the checklist of every pushed commit (`git show <sha>:docs/plans/execution-checklist.md`) and of the working tree with `activeItems` of `scripts/full-run.mjs`, and refuses the push with status 1. The refusal names each active ID with its task and the ref and commit or the working tree that holds it, states the rule and says to complete each task or to mark it `[!]` with its cause and retry condition. A pushed commit without the checklist, and a checklist that cannot be parsed, also refuse the push.

Git does not install hooks from a clone. Every `make` run therefore sets `core.hooksPath` to `.githooks` when it has another value, and `make hooks` sets it explicitly. `make hooks-check`, which `make docs-check` runs before each commit, and the guard of the full run fail while `core.hooksPath` is not `.githooks` or the hook is missing or not executable.

The workflow `.github/workflows/push-gate.yml` gates every push. Its job `push-gate` runs `make push-gate-commit COMMIT=<sha>`, which runs `node scripts/push-gate.mjs commit <sha>`, on the pushed commit of every branch and on the head commit of every pull request, so a push that skipped the hook, or came from a checkout without it, still fails there. It fails for a task in progress, for a commit without the checklist and for a commit that does not track `.githooks/pre-push` with mode 100755; it prints each line of the failure as an annotation and writes it into the job summary.

## CI

The workflow `.github/workflows/ci.yml` runs the full suite after a push to `main` and for every pull request (HY-91). Its job `check` has one entry per CI group of the Makefile, with `fail-fast: false`:

| Group | Targets | Setup |
|---|---|---|
| `docs` | `docs-check` | Node.js |
| `php` | `template-check`, `bench-server-smoke`, `lint`, `analyse-php`, `test-php` | Node.js, PHP, the template build, `make install`, `make install-rust` |
| `node` | `templates-check`, `test-scripts`, `test-js`, `test-node`, `package-check` | Node.js, PHP, the template build, `make install` |
| `board` | `parity`, `server-parity`, `bundle-size`, `e2e` | Node.js, PHP, the template build, `make install`, `make install-rust`, `make install-browser` |

Each step runs one make target (HY-90) and every step after the first runs after a failed step. `make ci-pins` gives the PHP minor of `config/toolchain.json` and the template branch of `config/template.json` to the workflow, which sets up PHP of that minor and checks out the template repository at that branch as `../template`, where `make install build-ts` builds its TypeScript package. `make ci-check GROUP=<group>` runs every target of the group with its own `make -k <target>` to its end and prints `[ci] start <target>` and `[ci] <target> passed|failed in <seconds> s`; it refuses outside GitHub Actions, because a checkout runs the full suite through `make check`. `make ci-summary GROUP=<group>` writes the job summary. The job uploads the artifact `ci-<group>-<run id>-<attempt>`, the directory `var/ci/<group>/`:

- `summary.md`: the commit, the tree, the template branch, the running releases of Node.js, npm, PHP with its patch, Composer and make, the outcome of each setup step, and a table of the targets with their status, time and first failure lines, followed by the first failure lines of each failed target;
- `record.json`: the same as data, written before and after each target, so a runner that stopped leaves the target that was running;
- `logs/<target>.log`: the command and the full output of each target and how make ended.

## Test runs

`scripts/run-tests.mjs <node|vitest|phpunit> [--timeout <seconds>] [--cwd <directory>] [--extension <file>] [--] [<arguments>]` runs a test tool, and `make test-js`, `make test-node`, `make test-php`, `make test-scripts` and `make package-check` run their tests through it. Every test prints a line when it starts, a line every 5 seconds while it runs and a line with its result and elapsed time, and the run ends with a line of the counts and the elapsed time. Every test has its own timeout, 30 seconds unless `--timeout` sets another: vitest and `node --test` fail the test at its timeout, and for PHPUnit, which `--teamcity` makes report each test, the runner stops PHPUnit and fails the test by its name. `--extension` loads a PHP extension into PHPUnit. `tests/scripts/run-tests.test.mjs` tests the runner and its reporters in `scripts/test-progress/`.

To run the tests that own a change, pass their files or a filter, for example `node scripts/run-tests.mjs vitest --cwd packages/hyper-js tests/router.test.ts` or `node scripts/run-tests.mjs phpunit --cwd packages/hyper-php -- --filter RouterTest`.

## Servers of a run

`make parity` and `make server-parity` start their own servers with `scripts/board-servers.mjs`: every server listens on a port that the system assigns, and the check sends its requests to the address that the server reports in its output (`Development Server (http://127.0.0.1:<port>) started` of PHP, `board on http://127.0.0.1:<port>` of the board Node server, `edge http://127.0.0.1:<port>` of `scripts/serve-edge.mjs`). A request therefore reaches a server of the same run, also while a run from another checkout or session runs. Starting a server is a step without a time limit: it prints its start, every output line of the server with the prefix `[<name>]` and its address with the elapsed time, and fails when the server exits first. The databases and the session directory of a run lie in a temporary directory, which `scripts/check-parity.mjs` prints as `run directory: <path>` and removes.

`make e2e` runs `scripts/run-e2e.mjs` in the same way: it starts the board example in both rendering modes (the API origin, the edge and the SSR origin) on an empty database in its run directory, and runs `playwright test` with the addresses in `HYPER_E2E_SSR` and `HYPER_E2E_CSR`, which `tests/e2e/origins.ts` requires; its arguments are passed to Playwright, for example `node scripts/run-e2e.mjs -g 'stylesheet'`. Playwright starts no server itself. `make bench-browser` starts its servers and its database in the same way.

## Server build

`scripts/build-server.mjs --manifest <app.json> --templates <directory> --output <directory> --template-dir <template repository> --php-namespace <namespace>` writes the server program (HY-48):

1. `templates/`: every template of the application and the reserved template `hyper/data.tpl`. The native extension reads these files.
2. `program.php`: the generated PHP program of the same templates, compiled with the compiler of the template repository into the given PHP namespace (`Polyspec\Hyper\Examples\Board\Program` for the board). `program.json` records the namespace, which the renderer reads. Every template renders as a target, and every definition is HTML, because the server renders each region alone.

PHP renders with the native extension when it has loaded `polyspec_template`, and otherwise with `program.php`. Both outputs are built from the same sources, so a server can switch by loading or not loading the extension.

## Node server

`make node-server` bundles `examples/board/node/main.ts` with esbuild into `examples/board/build/node/server.mjs`. The board Node server serves the same application as `examples/board/public/index.php`, with `node:sqlite` for the posts, and serves the files of `examples/board/public`:

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0` lets the system assign the port; the server prints `board on http://127.0.0.1:<port>` with the port that it listens on. `BOARD_SESSIONS` is an absolute session directory, and `BOARD_BASE_PATH`, `BOARD_HTTPS` and `BOARD_FRAME_ANCESTORS` have the meaning that they have for PHP. `BOARD_TIME`, for both servers, fixes the creation time of new posts in Unix seconds, so that `make server-parity` compares the same posts. The Node server renders with the template files of `make assets` (HY-54).

## Asset build

`scripts/build-assets.mjs --app <directory> --api <base path> --template-dir <template repository> --output <directory>` writes the following outputs with the template package of the template repository (HY-70). Below `public/assets/` it only adds files whose names hold a hash of their content and removes none; the outputs without a hash lie in the directory of `--output` (HY-34). `make assets` passes `examples/board/build`.

1. `public/assets/templates/<name>.<hash>.json`: one AST file per template under `templates/`, and one for the reserved template `hyper/data.tpl` (HY-34).
2. `<output>/templates.index.json`: each template name with its file URL (HY-34). The client imports it as `@polyspec/hyper/templates-index`.
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js` and `<output>/manifest.json`: the client entry, one chunk file per code that the entry imports with `import()` only, which the browser loads when that code first runs, and the URL of the entry as `hyper`, which the server passes to the layout (HY-76). The entry contains htmx, the hyper browser code, the template render runtime, `app/app.json` and the index, and no template. The build writes no file that the application names; the application places and links its own stylesheets.
4. With `--tailwind <source>=<output>`, the output stylesheet: the source compiled with the theme of Tailwind CSS and the utility classes that the files below `templates/` and `client/` use, with the rules of the source in the layer `components` and no rule of the layer `base` (HY-77).
5. `<output>/csr/`: the CSR deployment. `index.html` contains `<meta name="hyper-api">` and the entry inlined, and no stylesheet, because the browser applies the stylesheet links of the rendered layout (HY-64, HY-76); `assets/templates/` contains the template files of this build, and `assets/` contains the chunk files of this build. The deployment holds the files that `--static` names below `public/`, at the same path: the application names the stylesheets that its rendered layouts link, as `make assets` names `public/assets/app.css` and `public/assets/reader.css` of the board example. The deployment is published file by file, `index.html` last (HY-82). The build fails when the entry contains `</script`, and it prints the Content Security Policy with the hash of the inlined entry.

The build replaces earlier outputs, so repeated builds leave one file per output. The outputs are not committed.

## Proof that PHP, Node.js and the browser behave the same

| Behavior | Evidence |
|---|---|
| Kept values | `conformance/keep.json` runs in `make test-php` and `make test-js` (HY-38). |
| JSON text | `conformance/json.json` runs in `make test-php` and `make test-node`: the Node server writes the bytes of PHP `json_encode` and reads kept values as PHP `json_decode` does (HY-54). |
| Routing | `conformance/routes.json` runs in `make test-php` and `make test-js`. During rendering, the browser also requires that its route equals the route that the server reported (HY-20). |
| Document rendering | `make parity` requests every compare step as an HTML document, as document JSON and as region JSON in one session. The browser rendering of the document JSON, including route regions, the embedded data and `server` and `cookie` kept values (HY-30, HY-31, HY-38), must equal the PHP document byte for byte after the masked CSRF token of each response, which differs per response (HY-24), is replaced by `<csrf>`, and every part of the region JSON must appear in it. The check prints a line when a step starts and its result with the elapsed milliseconds; a request without a response within 10 seconds fails by the name of its step and ends the check. |
| Node server | `make server-parity` sends every request of the parity steps to the PHP server and the board Node server, each with its own database and session, and requires equal statuses, headers and bodies after it replaces the session identifier, the masked CSRF token of each response and the `ETag` value with placeholders (HY-55). |
| Behavior in a browser | `make e2e` runs the same flows on SSR and CSR: navigation, actions, `hy-set` changes without a data request, the four kept kinds across a reload and a new tab, loading only the templates of a route, the stylesheet links of the layout loaded before a page is shown and removed when another page does not link them (HY-64), and the comparison page that requires equal SSR and CSR bodies. |

## Measured sizes

Measured on 2026-10-05 with `make bundle-size` (htmx 4.0.0, esbuild 0.28.2, ten board templates and `hyper/data.tpl`):

| Output | Raw bytes | gzip bytes | brotli bytes | gzip limit |
|---|---:|---:|---:|---:|
| SSR script `hyper-<hash>.js` | 99,580 | 33,080 | 29,549 | 33,500 |
| CSR shell `build/csr/index.html` | 99,819 | 33,224 | 29,551 | 33,600 |
| Largest template file (`board/rows.tpl`) | 5,583 | 1,334 | 1,084 | 4,096 |
| All eleven template files | | 5,818 | | |

The limits of the SSR script and the CSR shell in `config/bundle-size.json` are the measured gzip sizes plus about 1 %, rounded up to 100 bytes. A change that makes an output larger than its limit changes the limit in the same change and states why the growth is needed; a change that makes an output smaller lowers the limit by the same rule.

The browser loads only the templates that its rendering reaches (HY-35), and a template file is cached by its hashed name. The AST of a template is about twice the size of its source after compression, because every node records its source span. `config/bundle-size.json` limits a template file to 4,096 gzip bytes, so a template that grows past it is split into blocks.
