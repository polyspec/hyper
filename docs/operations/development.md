<!-- doc-id: development -->
# Development

[한국어](development.ko.md).

## Toolchain

- The pinned toolchain (HR-81): Node.js and Python of `mise.toml` (mise installs them at the digests of `mise.lock`: Node.js with `make install-tools TOOLS=npm`, Python with `make install-tools`), PHP of `.php-version` with `pdo_sqlite`, GNU Make 3.81 or later, and phpize, php-config and a C compiler of that PHP for the native extension. `make hyper-install` installs npm of `mise.toml`, which `devEngines` of `package.json` names, and Composer of `config/toolchain.json` into `var/tools` (`make install-tools`). A tool that is missing fails the target that runs it (kit K854).
- The shared tools: `@polyspec/kit` is pinned by its release URL in `package.json` and integrity in `package-lock.json`. A fresh checkout runs `make bootstrap`, which runs native npm at the exact version that `devEngines` names, outside the checkout with `--prefix` (kit K938), to run `npm ci --ignore-scripts` with downloads explicitly enabled; then `make install-tools TOOLS=npm`, `make install-packages` and `make install-tools` prepare checkout tools. The Makefile includes no file of kit and holds every recipe of hyper; each recipe runs a utility of the installed package with explicit arguments. A native local package link uses the same path and needs no mandatory sibling checkout: the Makefile runs the sources of a link (`scripts/kit/*.mts`) and the dist of a packed archive (`dist/*.mjs`). The settings of the tools are native files of hyper: `allow-remote=root` of `.npmrc` (and of `tests/package-install/.npmrc`), `[settings]` and `[env]` of `mise.toml` for mise and uv, and the lint configurations `knip.json`, `.oxlintrc.json`, `ruff.toml`, `phpcs.xml.dist` and `phpstan.dist.neon`. Each utility of kit checks the `config/*.json` that it reads against its schema when it runs.
- The template packages: npm installs `@polyspec/template` and `@polyspec/template-compiler` from the tarballs of the template release and Composer installs `polyspec/template` from its zip, as `package.json`, `composer.json` and their locks pin them (HR-70); `make hyper-install` downloads them.
- The native template extension: the package `polyspec/template-php-ext` of the template release 0.0.26 (`TEMPLATE_VERSION`, the tag `TEMPLATE_TAG`), which PIE (`http:pie` of `mise.toml`, installed by `make install-tools TOOLS=pie`) builds from the Composer repository of the release, `https://github.com/polyspec/template/releases/download/v0.0.26/packages.json` (H14.1-7, H27.45). `make hyper-install` runs `make template-ext` through `$(ONLINE)`: its recipe runs `pie repository:add` and `pie build` itself in an empty `var/pie/polyspec/template-php-ext`, takes the one library that PIE recorded there with `scripts/pie-binary.mts` and publishes it to `build/ext/polyspec_template.so` (H27.51); `pie install` is not used, because it writes into the PHP of the machine. `make ext` builds nothing and only requires that library. Composer fetches the php zip `polyspec-template-php-0.0.26.zip` itself from the same Composer repository, whose dist names it by its URL and sha1 (H23.11, H27.45).
- The network: only `make install-tools`, `make install-packages`, `make hyper-install` and `make hyper-install-browser` download. Every other recipe runs npm and Composer offline (`npm_config_offline`, `COMPOSER_DISABLE_NETWORK`), so a missing download fails at once and names the install target that makes it (HR-89).
- Chromium for Playwright: `make hyper-install-browser`, which installs the Chromium of the pinned Playwright and, on Linux, its system libraries.

## Native Composer development

A development checkout links its polyspec providers (kit, template) only through the entries of its `.links` and `make link`. min-0-max/json-schema is the maintained fork of opis/json-schema, whose FORK.md states how it is kept and consumed: `composer.json` and `examples/board/composer.json` declare its VCS repository `https://github.com/min-0-max/json-schema` and require its release `2.6.0-p2`, and both locks pin that release at its commit with its dist. `packages/server/php/composer.json` names no repository, so a consumer of polyspec/hyper-server declares the fork in its own root. A checkout that edits the fork links it through the entry of its `.links` that names the checkout of the fork and `make link`, like a provider.

## Targets

| Target | Action |
|---|---|
| `make install-tools` | Installs npm of `mise.toml`, which `devEngines` names, and Composer of `config/toolchain.json` into `var/tools` and writes the commands of `var/tools/bin`, verifying each download by its pinned digest (HR-81) |
| `make install-packages` | Installs `package-lock.json` with the npm of `var/tools`, `@polyspec/kit` and the npm workspaces included, through `$(ONLINE)` |
| `make layout-check` | Checks the folder layout against `config/layout.yml`, which extends `config/layout.kit.yml`, with the alint of `var/tools` |
| `make hyper-install` | Installs the pinned tools, builds the native extension with PIE from the Composer repository of the template release through `$(ONLINE)` (`make template-ext`; H14.1-7, H27.45), runs `make hyper-install-python`, and installs the Composer dependencies, among them the template package of the template release (HR-70) |
| `make hyper-install-python` | Makes the venv `.venv` of the Python server package anew from the Python of `mise.toml` with the `python-venv` utility of kit and installs the package into it non-editable with its dependencies, the template wheel of the release included; the Python tests and the board Python server run its Python and read no source path (S5) |
| `make hyper-server-php-install` | Installs the Composer dependencies of the board, which link `polyspec/hyper-server` to `packages/server/php` (HR-79); run this target explicitly when installing dependencies |
| `make ext` | Fails unless `build/ext/polyspec_template.so` exists, the native template extension that `make template-ext` of `make hyper-install` builds with PIE from the Composer repository (`packages.json`) of the template release; it runs offline and builds nothing (HY-48, H27.45) |
| `make packages` | Builds the JavaScript modules and type declarations of `@polyspec/hyper-client` and `@polyspec/hyper-server` into their `dist` directories with the declared build of each package (`npm run build`, which runs the `tsc` of the bin link of npm) and publishes each build file by file; npm links the workspaces, so `node_modules` shows the build at once (HR-79, HR-82); the Node server tests, the board asset build, `make package-check` and `make hyper-test-scripts` run it first, because they import the packages through their exports (HR-61). The build scripts read `data-template.json`, `checkManifest` and `templateReferences` from the source of `packages/client` next to them, so they do not need `dist` and run from any working directory |
| `make package-check` | Installs both packages into `tests/package-install` offline from its `package-lock.json` with `npm ci --offline`, which links them to their directories (HR-89), checks the files that `npm pack` publishes, type-checks its test against their declarations with `erasableSyntaxOnly` and runs it under `node` (HR-61) The test receives the pinned npm through `NPM_BIN`; `tests/package-install/var/` holds ignored native link state. |
| `make server` | Builds the board server program into `examples/board/build/server` from installed source packages without installing or relinking dependencies (see below) |
| `make server-fixtures` | Builds the server program of the PHP test fixtures |
| `make node-fixtures` | Builds the template files of the PHP test fixtures for the Node server tests with `scripts/build-templates.mts` and the installed template package (HR-70) |
| `make node-server` | Type-checks and bundles the board Node server into `examples/board/build/node/server.mjs` (see below) |
| `make assets` | Builds the board client bundle and the CSR shell (see below) |
| `make test-js` | Runs the browser code tests, including the router conformance cases, and the type check |
| `make hyper-test-node` | Runs the Node server tests: the cases of the PHP server tests against the same fixtures, the JSON cases of `contracts/json.json`, sessions, the HTTP server, and the type check |
| `make test-php` | Runs the server package tests, including the router conformance cases, once with the generated program and once with the native extension |
| `make lint` | Checks PHP formatting |
| `make analyse-php` | Runs PHPStan at level `max` on the source and the tests of `packages/server/php` with `packages/server/php/phpstan-max.neon`, without a baseline and without ignored errors. PHPStan writes its cache to `build/phpstan`. It runs with `--memory-limit=256M`, because a run without that cache needs 132 MB in its worker, above the default PHP limit of 128M. It runs `make ext` first |
| `make templates-check` | Checks that only the layout template carries `hx-` attributes (HC-6), that the layout places `{# title}` and `{# data}` once, and that every region of the layout and of each route template is placed once, directly inside an element whose `id` is the region name, without block arguments (HY-3, HY-30) |
| `make typecheck` | Checks the types of the TypeScript of `scripts/`, `tests/` and `benchmarks/` with the tsc of `node_modules` and the root `tsconfig.json` (strict, `erasableSyntaxOnly`); Node runs these `.mts` files by type stripping and never checks them (S9). It runs `make packages` first, since `scripts/check-parity.mts` imports the types that the build of `@polyspec/hyper-client` writes |
| `make lint-ts` | Lints the TypeScript with the oxlint of kit (`.oxlintrc.json`, type-aware) and its unused files, dependencies and exports with knip (`knip.json`); a target of `make check` and of the CI entry `gates` (H23.13) |
| `make hyper-test-scripts` | Runs the tests of the check scripts, such as the region placement check with a broken fixture application |
| `make virtiofs-check` | Runs the server build and the output copies in Apple `container` with the output on a virtiofs bind mount (HR-68); a target of `make check` on Darwin only (`DARWIN_TARGETS`), which fails when `container` is missing. It runs only on Darwin because the virtiofs bind mount that it tests exists only in Apple `container`, and no Linux target of CI checks that symptom. The cause is tested on every platform by `tests/scripts/output-files.test.mts` |
| `make parity` | Compares PHP documents with browser renders of document and region JSON, once with the generated program and once with the native extension |
| `make server-parity` | Runs the parity steps against the PHP server and the board Node server and compares the status, the headers and the body of every response, with the browser comparison of `make parity` (HR-55) |
| `make bundle-size` | Prints the sizes of the SSR script, the CSR shell, the chunk files of the static deployment together and the largest template with their gzip limits in `config/bundle-size.json`; a size above its limit prints a `WARNING` line, on GitHub also an annotation `::warning::` and a warning in the CI summary, and the target passes |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers and a database of the run (`scripts/run-e2e.mts`) |
| `make owner-check` | Runs the owners of the changed paths that `config/owner-checks.json` declares; `PATHS` names the paths and `BASE` takes the changes since a revision (HR-88) |
| `make owner-validate` | Fails when a tracked path has no owner or `config/owner-checks.json` names a missing target or test file (HR-88) |
| `make rules-check` | Fails when a rule of `PRINCIPLES.md` or `AGENTS.md` names a check that no step of a workflow of `.github/workflows` reaches, or no check (P3) |
| `make docs-check` | Checks the documents of `config/documents.json`: translation pairs, the `doc-id` and `source-sha256` markers, links, code blocks, the changelog and the checklist |
| `make hooks` | Declares the merge drivers of the changelogs and the checklists (see [Hooks](#hooks)) |
| `make hooks-check` | Fails while the merge drivers of `make hooks` are not declared |
| `make ci-targets` | Runs the make targets `TARGETS` to their ends and writes the report `CI_REPORT` (see [CI](#ci)) |
| `make ci-summary` | Writes the summary of the report `CI_REPORT` and the job summary (see [CI](#ci)) |
| `make ci-passed` | Fails unless every job of `RESULTS`, the JSON of `needs`, has the result `success` (see [CI](#ci)) |
| `make hyper-install-browser` | Installs the Chromium of the pinned Playwright and, on Linux, its system libraries; a download through `$(ONLINE)` (HR-89) |
| `make serve-demo` | Serves SSR, CSR and the comparison page on the fixed ports 8080 to 8082 while it holds the lock `/tmp/hyper-serve-demo.lock`; a second demo fails with the holder (see [Deployment](deployment.md)) |
| `make serve-demo-unlock` | Removes the lock of a demo whose process has ended; fails while the demo runs |
| `make bench-server-smoke` | Runs the PHP benchmark once per measurement; `make check` includes it so that a change that breaks the benchmark fails |
| `make bench` | Runs `make bench-server` and `make bench-browser`, which report server and browser performance (see [Benchmark](benchmark.md)); they are not part of `make check` |
| `make check` | Runs every check above through the native final-verification runner (see below) |

The Darwin virtiofs tests read the digest-pinned `VIRTIOFS_IMAGE` of the Makefile. `make hyper-install-virtiofs` installs that image explicitly; the tests inspect the local image first and fail with that install target when it is missing. The tests mount this checkout and any external source providers read-only at their original paths. Provider roots are discovered with `git rev-parse --show-toplevel` from the installed template and compiler module entries; this preserves native package source links and their dependency resolution inside the container.

`lint-ts` builds workspace declarations through `packages` before inspecting them.

Script checks require `assets` and `server` before the runner. `package-check` delegates locked installation and compatible source links to native npm, then checks types and executes the installed packages without setting up editor hooks.

## Full run

The full suite runs on GitHub after the push of `main`. A local full run is not required before a commit or push. During checklist development, run only the unit checks that own the change. Run `make check` exactly once after checklist development finishes; after a failure, fix and rerun only its owners. A new commit does not call for another full run.

`make check` invokes the native kit `ci-targets` runner with all `CHECK_TARGETS`, and `DARWIN_TARGETS` on Darwin. Run it on a committed tree with no active `[~]` checklist item; the runner refuses nothing (kit K1053), holds `var/report/full-run.lock`, and runs every target to completion despite failures. `GATE_TARGETS`, the checkers of kit, are targets of this set. Darwin includes `virtiofs-check`; Linux CI does not.

The runner writes the tree, runtime versions, target status and times to `var/report/full-run/record.json`, a summary to `summary.md`, and full logs to `targets/<target>.log`. Its summary includes failed-target evidence. The runner does not enforce a once-per-tree limit; the once-only procedure above is the working rule. Installed source links remain development inputs; `make link-check` compares them with the link declaration `.links` (kit K869).

Host suspension can exceed a test deadline while execution is stopped. Preserve that failure and the matching suspension interval, then rerun only the affected owner after resume; do not increase its deadline or claim a code repair without a reproduced code defect.

Read the failed target names from that report. Run their owner checks directly, or group only those targets with `make ci-targets TARGETS="<failed targets>" CI_REPORT=var/report/failed-owners` once the repair is committed and no item is active. Preserve the original report and use a separate report for repairs. Owner reruns are evidence for those repairs; they do not turn the original full run into a passing run of another tree.

## Hooks

hyper keeps no Git hook. `make hooks` declares the merge drivers of `CHANGELOG.md`, the checklists and their Korean twins in `.git/info/attributes` and the git configuration; git runs each driver as `make twin-merge`. `make commit` writes the message of a commit, which it does not judge (kit K1053). A push is not checked: the CI run of a commit is read at release.

## Publishing main

Until version 0.1 this repository has no pull request, no merge queue and no GitHub ruleset (HR-94). A change is checked by the unit tests that own it, each task of the checklist becomes `[o]` in its own commit, and `main` is pushed once, when every task is `[o]`:

```sh
git push origin main
```

The push of `main` runs `.github/workflows/ci.yml`, the full suite (see [CI](#ci)), the checkers of kit in its entry `gates` included, and its last job `ci-passed` passes only when every other job passed. A release takes the id of such a successful run and tags its commit (see [Tag releases](#tag-releases)).

## Tag releases

A release is the commit of a successful run of `.github/workflows/ci.yml` on `main`, tagged `vX.Y.Z` (HR-95, the procedure in `AGENTS.md`). `.github/workflows/release.yml` starts by itself when the CI run of a push whose tip is the version-bump commit succeeds (kit K987), and the maintainer can start it again with the id of that run alone (`gh workflow run release.yml -f run=<id>`); the version is the first section `## X.Y.Z` of `CHANGELOG.md` at the commit of that run (kit K924); no tag push starts it. Its steps run `release` of `@polyspec/kit`, configured by `config/release.json`, in this order and stop at the first failure:

```sh
make release-tag
make release-prepare
make release-tools
make release-assets
make release-publish
make release-undraft
```

`make release-tag` requires a completed successful push or manual run of ci.yml on `main` whose commit is on `origin/main`, reads X.Y.Z from the first section `## X.Y.Z` of `CHANGELOG.md` at that commit (kit K924), and creates and pushes the annotated tag `vX.Y.Z` at that commit; the later steps run on that tag. `make release-prepare` runs `make hyper-install`, and `make release-tools` installs the tools of the release. `make release-assets` builds the packages (`make packages`) and writes `polyspec-hyper-client-X.Y.Z.tgz`, `polyspec-hyper-server-X.Y.Z.tgz`, `polyspec-hyper-build-X.Y.Z.tgz`, `polyspec-hyper-server-X.Y.Z.zip` and the wheel `polyspec_hyper_server-X.Y.Z-py3-none-any.whl`, built by `uv build --wheel` with the build backend of `build-system.requires` of `packages/server/python/pyproject.toml`, into `var/release/assets`; an archive keeps the name its packer gives and carries the GitHub label `<vendor>-<product>-<runtime>-<version>` of the product and the runtime that `config/release.json` declares for its package (kit P39). `make release-publish` creates the draft GitHub Release with the archives and the section as notes when it has at most 125000 characters, the limit of GitHub; a longer section becomes the one line `The changes of X.Y.Z are listed in [CHANGELOG.md](https://github.com/polyspec/hyper/blob/<tag>/CHANGELOG.md#<anchor>).`, which links `CHANGELOG.md` at the tag with the anchor of the section: the id of an `<a id="...">` line above the heading, or else the version without its dots; `make release-undraft` then makes the release public. The Python package `packages/server/python` is released as that wheel (kind `wheel` of kit, H23.15); its only dependency is the wheel of the template release, a direct reference with the sha256 of that asset, which `packages/server/python/uv.lock` locks with its dependencies. The job sets up Node.js, Python, PHP and `make hyper-install` as the job `check` of `ci.yml` does; the tag reaches the steps through the environment variable `TAG`, which `make release-tag` writes. `make release-coverage` fails for a tracked manifest that `config/release.json` lists neither in `manifests` nor in `notReleased` with its reason, here `tests/package-install/package.json`, `examples/board/composer.json` and the private root `composer.json`.

The published manifests are the manifests of the tree, and `make release-assets` packs them unchanged (HR-95). A published manifest names every polyspec package by an exact version: `packages/client/package.json`, `packages/server/ts/package.json` and `packages/build/package.json` require `@polyspec/template` (and `packages/build/package.json` also `@polyspec/template-compiler`) at the version of the template release and `@polyspec/hyper-client` at the version of the release, and `packages/server/php/composer.json` declares `version`, requires `polyspec/template` at the version of the template release and has no `repositories`.

A consumer checks a release by installing its archives with its own package manager; no step of the release installs them.

### Development layout

The private roots resolve the packages in the checkout and are never published. The root `package.json` declares the npm workspaces `packages/client`, `packages/build` and `packages/server/ts`, which npm links (HR-79), and `@polyspec/template` and `@polyspec/template-compiler` by the URLs of the tarballs of the template release, with `overrides` that make their exact versions resolve to these tarballs, and `.npmrc` sets `allow-remote=root`, because npm 12 installs no URL dependency by default. The root `composer.json` installs into the root `vendor` from the path repository `packages/server/php` and from the Composer repository of the template release, its `packages.json`, whose dist names the zip by its URL and sha1, and maps the namespaces of `packages/server/php` to the tree; `composer.lock` is its lock. Both roots take the template release v0.0.26 (HR-70), the tag `TEMPLATE_TAG` of the Makefile whose package `polyspec/template-php-ext` `make template-ext` builds (HR-80).

### Installing the release assets

A consumer downloads the assets of the releases that it needs and installs them together; no registry is needed. With npm, the consumer lists every tarball as a `file:` dependency, and each exact version of a packed manifest is satisfied by the tarball installed beside it:

```json
{
  "dependencies": {
    "@polyspec/hyper-server": "file:polyspec-hyper-server-X.Y.Z.tgz",
    "@polyspec/hyper-build": "file:polyspec-hyper-build-X.Y.Z.tgz",
    "@polyspec/hyper-client": "file:polyspec-hyper-client-X.Y.Z.tgz",
    "@polyspec/template": "file:polyspec-template-npm-T.T.T.tgz",
    "@polyspec/template-compiler": "file:polyspec-template-compiler-npm-T.T.T.tgz"
  }
}
```

With Composer, the consumer declares the Composer repositories of both releases, the `packages.json` that each release publishes beside its archives, and requires `polyspec/hyper-server`; the repository of the template release serves `polyspec/template`:

```json
{
  "repositories": [
    { "type": "composer", "url": "https://github.com/polyspec/hyper/releases/download/vX.Y.Z/packages.json" },
    { "type": "composer", "url": "https://github.com/polyspec/template/releases/download/vT.T.T/packages.json" }
  ],
  "require": { "polyspec/hyper-server": "X.Y.Z" }
}
```

T.T.T is the version of `@polyspec/template` that `packages/client/package.json` of the release requires. A consumer that builds its application installs `@polyspec/hyper-build` and runs its bins from `node_modules/.bin` (HR-96, [Server build](#server-build), [Asset build](#asset-build)).

## CI

Every check group sets up PHP before `make install-tools`, because tool discovery reads `.php-version` even for a group that tests another runtime. After package installation, `make hooks` creates the per-checkout Git merge-driver attributes and hook configuration before validation.


The workflow `.github/workflows/ci.yml` runs the full suite for the push of `main` and every manual run (`workflow_dispatch`) (HR-91, see [Publishing main](#publishing-main)). Its job `check` has one matrix entry per CI group, with `fail-fast: false`, and each entry names the targets that it runs:

| Entry | Tools selected after bootstrap | Locked package environments | Targets |
|---|---|---|---|
| `gates` | Node/npm, PHP/Composer, PIE, Python/uv, ruff, vulture, alint, phpcs, phpstan | Root npm, root and board Composer, Python uv locks | The checkers of kit: configuration, layout, documents, owners, rebuild classes, language, duplication, suppressions, and the lint of TypeScript, PHP and Python (`GATE_TARGETS`) |
| `docs` | Node/npm, PHP/Composer, PIE, Python/uv | Root and board Composer locks | Type check and script checks |
| `php` | Node/npm, PHP/Composer, PIE | Root and board Composer locks | PHP policy, benchmark smoke, formatting, analysis and tests |
| `node` | Node/npm | Root npm lock | Template, browser-unit, Node-server and npm consumer checks |
| `board` | Node/npm, PHP/Composer, PIE, Python/uv | Root npm, root and board Composer, Python uv locks | Browser parity, Node/Python server comparisons, bundle sizes and E2E |
| `python` | Node/npm, Python/uv | Root npm and Python uv locks | Python unit and rendering checks |

Each group calls `make install-tools TOOLS="${{ matrix.tools }}"`; Kit owns selection, mandatory tool dependencies, version and hash validation, and reuse of matching installed tools. Hyper declares no alternate tool installer. The pinned Kit installer supports these selectors; the `docs`, `php` and `board` groups, whose `make hyper-install-php` builds the native template extension, select `pie`. npm uses its separate bootstrap; the `gates` group explicitly installs the PHP symbol extractor through `make install-symbols EXTRACTORS="php"`, whose php-parser `make lint-php` reads. Only the `gates` group installs the lint tools of kit (phpcs, phpstan, ruff, alint, vulture), which its targets start; `make hyper-lint` and `make analyse-php` run the pint and PHPStan of `vendor`.

`make hyper-install-php` installs only the pinned PHP archives and the root and board Composer locks, under the existing installation lock. `make hyper-install-python` installs only the Python environment through the `uv-install` utility of kit, which runs `uv sync --locked` (kit K850). Node dependencies use the existing npm lock installation. Native source development links remain a separate local installation choice.

Build prerequisites belong to the checks in their own job. No language job waits for another language job or downloads its environment or build artifacts. Installation is online; builds and checks retain the offline environment.

Each implementation's own tests run the shared vectors of `contracts/`; no gate matches test names across languages (H27.91). Browser-dependent cross-server comparisons belong to `board`, which installs all three implementations and Chromium itself. Python rendering tests belong to the Python job. The matrix aggregate requires every group result for `ci-passed`.

Each command step runs one make target (HR-90), and steps continue after an earlier failure to collect all reports. Each job checks hyper out at the workspace root and runs the bootstrap action of hyper (`./.github/actions/bootstrap`) right after the checkout, which uses Node from `mise.toml`; the matrix selects the remaining pinned tools and conditionally prepares PHP, Composer, Python and Chromium. No job checks out another repository: the pinned release assets provide the template packages and the extension sources. `make ci-targets TARGETS="<targets>" CI_REPORT=var/ci/<name>` runs every target of the entry with its own `make -k <target>` to its end and writes the report. `make ci-summary CI_REPORT=var/ci/<name>` writes the job summary. The job uploads the artifact `ci-<name>-<run id>-<attempt>`, the directory `var/ci/<name>/`:

- `summary.md`: the tree, the running releases of Node.js, npm, PHP with its patch, Composer and make, the outcome of each setup step, and a table of the targets with their status, time and first failure lines, followed by the first failure lines of each failed target;
- `record.json`: the same as data, written before and after each target, so a runner that stopped leaves the target that was running;
- `targets/<target>.log`: the command and the full output of each target and how make ended.

The last job `ci-passed` runs after every other job and runs `make ci-passed RESULTS='<JSON of needs>'`, which prints the result of every needed job and fails unless each one is `success`. A job added to `ci.yml` is listed in `needs`; `tests/scripts/ci-workflow.test.mts` fails when `ci-passed` is missing, is not the last job, lacks `if: ${{ always() }}`, does not need every other job, runs on another runner or runs another step.

The workflow `.github/workflows/bench.yml` runs the benchmarks on a manual run: one job runs `make ci-targets TARGETS="bench bench-sessions"` and uploads the report. Its results pass or fail no check, and neither `ci-passed` nor a release reads it (see [Benchmark](benchmark.md)).

## Test runs

`node node_modules/@polyspec/kit/dist/run-tests.mjs <node|vitest|go|cargo|phpunit> [--cwd <directory>] [--php-extension <file>] [--] [<arguments>]` runs a test tool, and `make test-js`, `make hyper-test-node`, `make test-php`, `make hyper-test-scripts` and `make package-check` run their tests through it; PHPUnit is the one of the vendor directory of `COMPOSER_VENDOR_DIR`, which `make test-php` sets to the root `vendor`. Every test prints a line when it starts, a line every 5 seconds while it runs and a line with its result and elapsed time, and the run ends with a line of the counts and the elapsed time. The runner sets no time limit: it runs the tool and passes its output and exit code through. `--php-extension` loads a PHP extension into PHPUnit. kit tests the runner and its reporters.

To run the tests that own a change, pass their files or a filter, for example `node node_modules/@polyspec/kit/dist/run-tests.mjs vitest --cwd packages/client tests/router.test.ts` or `COMPOSER_VENDOR_DIR=$PWD/vendor node node_modules/@polyspec/kit/dist/run-tests.mjs phpunit --cwd packages/server/php -- --filter RouterTest`.

## Servers of a run

`make parity` and `make server-parity` start their own servers with `scripts/board-servers.mts`: every server listens on a port that the system assigns, and the check sends its requests to the address that the server reports in its output (`Development Server (http://127.0.0.1:<port>) started` of PHP, `board on http://127.0.0.1:<port>` of the board Node server, `edge http://127.0.0.1:<port>` of `scripts/serve-edge.mts`). A request therefore reaches a server of the same run, also while a run from another checkout or session runs. Starting a server is a step without a time limit: it prints its start, every output line of the server with the prefix `[<name>]` and its address with the elapsed time, and fails when the server exits first. The databases and the session directory of a run lie in a temporary directory, which `scripts/check-parity.mts` prints as `run directory: <path>` and removes.

`make e2e` runs `scripts/run-e2e.mts` in the same way: it starts the board example in both rendering modes (the API origin, the edge and the SSR origin) on an empty database in its run directory, and runs the command after `--` with the addresses in `HYPER_E2E_SSR` and `HYPER_E2E_CSR`, which `tests/e2e/origins.ts` requires. `make e2e` passes the Playwright run of the shared test runner, which reports each case with its own timeout (H27.26); `make e2e CASES=stylesheet` runs the cases whose title matches, and a run without a selection runs only in CI. Playwright starts no server itself. `make bench-browser` starts its servers and its database in the same way.

## Server build

`hyper-build-server --manifest <app.json> --templates <directory> --output <directory> --php-namespace <namespace>`, a bin of the build package `@polyspec/hyper-build` (HR-96), writes the server program (HY-48); `make server` runs it from the checkout as `node packages/build/bin/hyper-build-server.mjs`:

1. `templates/`: every template of the application and the reserved template `hyper/data.tpl`. The native extension reads these files.
2. `php/`: the generated PHP program of the same templates, compiled with the compiler package `@polyspec/template-compiler` that `@polyspec/hyper-build` requires (HR-70) into the given PHP namespace (`Polyspec\Hyper\Examples\Board\Program` for the board) as PSR-4 files, one class per file. `program.json` records the namespace, which the renderer reads. The application maps the namespace to this directory in `autoload.psr-4` of its `composer.json`, as `examples/board/composer.json` maps `Polyspec\Hyper\Examples\Board\Program\` to `build/server/php/` and the root `composer.json` maps the namespace of the test fixtures to `packages/server/php/tests/build/server/php/`, and the renderer loads the class `GeneratedProgram` through the autoload of Composer. Every template renders as a target, and every definition is HTML, because the server renders each region alone.
3. `reads.json`: the read paths of every route, computed with `routeReads` of `@polyspec/hyper-client` (HY-73).

PHP renders with the native extension when it has loaded `polyspec_template`, and otherwise with the generated program of `php/`. Both outputs are built from the same sources, so a server can switch by loading or not loading the extension.

## Node server

`make node-server` bundles `examples/board/node/main.ts` with esbuild into `examples/board/build/node/server.mjs`. The board Node server serves the same application as `examples/board/public/index.php`, with `node:sqlite` for the posts, and serves the files of `examples/board/public`:

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0` lets the system assign the port; the server prints `board on http://127.0.0.1:<port>` with the port that it listens on. `BOARD_SESSIONS` is an absolute session directory, and `BOARD_BASE_PATH`, `BOARD_HTTPS` and `BOARD_FRAME_ANCESTORS` have the meaning that they have for PHP. `BOARD_TIME`, for both servers, fixes the creation time of new posts in Unix seconds, so that `make server-parity` compares the same posts. The Node server renders with the template files of `make assets` (HY-54).

## Asset build

`hyper-build-assets --app <directory> --api <base path> --output <directory>`, a bin of `@polyspec/hyper-build` (HR-96), writes the following outputs with the template package `@polyspec/template` that the build package requires (HR-70); `make assets` runs it from the checkout as `node packages/build/bin/hyper-build-assets.mjs`. Below `public/assets/` it only adds files whose names hold a hash of their content and removes none; the outputs without a hash lie in the directory of `--output` (HR-34). `make assets` passes `examples/board/build`.

1. `public/assets/templates/<name>.<hash>.json`: one AST file per template under `templates/`, and one for the reserved template `hyper/data.tpl` (HR-34).
2. `<output>/templates.index.json`: each template name with its file URL (HR-34). The client imports it as `@polyspec/hyper-client/templates-index`.
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js` and `<output>/manifest.json`: the client entry, one chunk file per code that the entry imports with `import()` only, which the browser loads when that code first runs, and the URL of the entry as `hyper`, which the server passes to the layout (HYC-16). The entry contains htmx, the hyper browser code, the template render runtime, `app/app.json` and the index, and no template. The build writes no file that the application names; the application places and links its own stylesheets.
4. With `--tailwind <source>=<output>`, the output stylesheet: the source compiled with the theme of Tailwind CSS and the utility classes that the files below `templates/` and `client/` use, with the rules of the source in the layer `components` and no rule of the layer `base` (HR-77). Tailwind CSS is a dependency of `@polyspec/hyper-build`, so an application that writes its lock with npm 12.2.0 under the default `allow-remote=none` meets the npm defect of [Tag releases](#tag-releases): npm refuses the tarball of `@tailwindcss/oxide-wasm32-wasi` with `EALLOWREMOTE` ([npm/cli#9818](https://github.com/npm/cli/pull/9818)) until an npm release contains the fix.
5. `<output>/csr/`: the CSR deployment. `index.html` contains `<meta name="hyper-api">` and the entry inlined, and no stylesheet, because the browser applies the stylesheet links of the rendered layout (HYC-15, HYC-16); `assets/templates/` contains the template files of this build, and `assets/` contains the chunk files of this build. The deployment holds the files that `--static` names below `public/`, at the same path: the application names the stylesheets that its rendered layouts link, as `make assets` names `public/assets/app.css` and `public/assets/reader.css` of the board example. The deployment is published file by file, `index.html` last (HR-82). The build fails when the entry contains `</script`, and it prints the Content Security Policy with the hash of the inlined entry.

The build replaces earlier outputs, so repeated builds leave one file per output. The outputs are not committed.

## Proof that PHP, Node.js and the browser behave the same

| Behavior | Evidence |
|---|---|
| Kept values | `contracts/keep.json` runs in `make test-php` and `make test-js` (HY-38). |
| JSON text | `contracts/json.json` runs in `make test-php` and `make hyper-test-node`: the Node server writes the bytes of PHP `json_encode` and reads kept values as PHP `json_decode` does (HY-54). |
| Routing | `contracts/routes.json` runs in `make test-php` and `make test-js`. During rendering, the browser also requires that its route equals the route that the server reported (HYC-1). |
| Document rendering | `make parity` requests every compare step as an HTML document, as document JSON and as region JSON in one session. The browser rendering of the document JSON, including route regions, the embedded data and `server` and `cookie` kept values (HY-30, HY-31, HY-38), must equal the PHP document byte for byte after the masked CSRF token of each response, which differs per response (HY-24), is replaced by `<csrf>`, and every part of the region JSON must appear in it. The check prints a line when a step starts and its result with the elapsed milliseconds; a request without a response within 10 seconds fails by the name of its step and ends the check. |
| Node server | `make server-parity` sends every request of the parity steps to the PHP server and the board Node server, each with its own database and session, and requires equal statuses, headers and bodies after it replaces the session identifier, the masked CSRF token of each response and the `ETag` value with placeholders (HR-55). |
| Behavior in a browser | `make e2e` runs the same flows on SSR and CSR: navigation, actions, `hy-set` changes without a data request, the four kept kinds across a reload and a new tab, loading only the templates of a route, the stylesheet links of the layout loaded before a page is shown and removed when another page does not link them (HYC-15), and the comparison page that requires equal SSR and CSR bodies. |

## Measured sizes

Measured on 2026-10-15 with `make bundle-size` (htmx 4.0.0, esbuild 0.28.2, template 0.0.12, ten board templates and `hyper/data.tpl`):

| Output | Raw bytes | gzip bytes | brotli bytes | gzip limit |
|---|---:|---:|---:|---:|
| SSR script `hyper-<hash>.js` | 108,828 | 35,488 | 31,568 | 35,900 |
| CSR shell `build/csr/index.html` | 109,067 | 35,623 | 31,649 | 36,000 |
| Chunks `hyper-chunk-<hash>.js` (the template decoder), each compressed alone | 86,654 | 7,610 | 5,894 | 7,700 |
| Largest template file (`board/rows.tpl`) | 5,583 | 1,337 | 1,084 | 4,096 |
| All eleven template files | | 5,898 | | |

The limits of the SSR script, the CSR shell and the chunks in `config/bundle-size.json` are the measured gzip sizes plus about 1 %, rounded up to 100 bytes. The limits of 2026-10-05 were 33,500 and 33,600 for a script of 33,080 gzip bytes (99,580 raw); the growth is needed (H23.24):

- The board decodes each template file that it fetches with `decodeTemplate` of `@polyspec/template/decode`, because the JSON crosses a trust boundary at run time and the type-checked lint of kit forbids reading it with a cast (H23.13). The decoder is 86,639 raw bytes and about 7,600 gzip bytes. The board imports it with `import()` in its template fetcher, so it is a chunk (HYC-16): a server-rendered page, which loads no template (HYC-12), never loads it, and the static shell loads it with its first template.
- The protocol code of the entry grew between 2026-10-05 and the release 0.0.17, by about 1,800 gzip bytes with the same htmx: the region rendering, the response decoding, the kept values, the stylesheets and the routing of `@polyspec/hyper-client`, and the render runtime of template 0.0.12 is about 500 gzip bytes larger than that of 0.0.6. The entry holds, in raw bytes after minification, the render runtime of `@polyspec/template` 40,623, `htmx.org` 36,592, `@polyspec/hyper-client` 28,703 (`hyper.js` 13,737, `response.js` 4,385, `manifest.js` 3,224, `keep.js` 2,044, `router.js` 1,948, `stylesheets.js` 1,605, `templates.js` 1,065, `obtain.js` 699) and the board 2,098 with the index 771; alone, htmx compresses to 13,240 gzip bytes and the render runtime to 12,734.

A size above its limit is a warning, not a failure (AGENTS); a change that makes an output larger than its limit changes the limit in the same change and states why the growth is needed; a change that makes an output smaller lowers the limit by the same rule.

The browser loads only the templates that its rendering reaches (HYC-12), and a template file is cached by its hashed name. The AST of a template is about twice the size of its source after compression, because every node records its source span. `config/bundle-size.json` limits a template file to 4,096 gzip bytes, so a template that grows past it is split into blocks.

All runtime test targets use the installed Kit runner, including Python discovery with the package virtual environment. Scoped Python checks use exact discovery filenames or dotted module names through `--cwd`; the application has no private unittest harness. Report unsupported or defective runner behavior to the Kit GitHub issue tracker rather than replacing the runner or changing CI identity. Completed historical verification records retain their original commands and are not current execution instructions.

Every workflow of `.github/workflows` and the action `.github/actions/bootstrap` are files of hyper, and each of their command steps runs a target of the Makefile.
