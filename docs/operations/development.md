<!-- doc-id: development -->
# Development

[한국어](development.ko.md).

## Toolchain

- The pinned toolchain (HY-81): Node.js of `.node-version`, PHP of `.php-version` with `pdo_sqlite`, Python of `.python-version`, GNU Make 3.81 or later, and phpize, php-config and a C compiler of that PHP for the native extension. `make install` installs npm of `packageManager` and Composer of `config/toolchain.json` into `var/tools` (`make install-tools`); `make toolchain-check` names every tool that differs from its pin.
- The shared tools: `scripts/kit/` and `tests/kit/` are the copy of the tag `v0.0.6` of the shared tool repository `polyspec/kit` (`kit.json`, `.kit/kit.lock.json`), and `config/*.json` configures them. `make kit-sync KIT_TAG=<tag>` writes the copy and is the only command that changes it; `make kit-check` fails when a file differs from the lock or a `config/*.json` file breaks its schema, and `make kit-test` runs the tests of the tools.
- The template packages: npm installs `@polyspec/template` and `@polyspec/template-compiler` from the tarballs of the template release and Composer installs `polyspec/template` from its zip, as `package.json`, `composer.json` and their locks pin them (HY-70); `make install` downloads them.
- The template repository at `../template` (`TEMPLATE_REPOSITORY`) with its tag `v0.0.4` (`TEMPLATE_TAG`, HY-80), only for the native extension: `make template` copies its C sources, its stub and its build script into `var/products/template` (HY-78), and `make template-tag` fails without the tag. This repository builds nothing there.
- The network: only `make install-tools`, `make install`, `make install-browser` and `make kit-sync` download. Every other recipe runs npm and Composer offline (`npm_config_offline`, `COMPOSER_DISABLE_NETWORK`), so a missing download fails at once and names the install target that makes it (HY-89).
- Chromium for Playwright: `make install-browser`, which installs the Chromium of the pinned Playwright and, on Linux, its system libraries.

## Targets

| Target | Action |
|---|---|
| `make install-tools` | Installs npm of `packageManager` and Composer of `config/toolchain.json` into `var/tools` and writes the commands of `var/tools/bin`, verifying each download by its pinned digest (HY-81) |
| `make toolchain-check` | Fails when Node.js, npm, PHP, Python or Composer differs from its pin and names the expected and the actual value of each (HY-81) |
| `make kit-sync` | Copies the shared tools of `KIT_TAG` into `scripts/kit/` and `tests/kit/` and writes `.kit/kit.lock.json`; a second run at the same tag prints `unchanged` |
| `make kit-check` | Fails when a vendored file differs from `.kit/kit.lock.json`, is missing or is not in the lock, or when a `config/*.json` file breaks its schema |
| `make kit-test` | Runs the tests of the shared tools in `tests/kit` |
| `make install` | Writes the declared copy of the native extension sources of the template repository and the copy of `packages/hyper-php`, and installs npm and Composer dependencies, among them the template packages of the template release (HY-70), as copies without bin links (HY-79) |
| `make hyper-php-copy` | Writes the copy `var/products/hyper-php` of the tracked files of `packages/hyper-php` and publishes it into the Composer copy of the board (HY-79, HY-82); `make server` runs it first |
| `make template` | Writes the declared copy `var/products/template` of the native extension sources of the commit of the template tag `TEMPLATE_TAG` with `scripts/copy-template.mjs`, which writes nothing while the copy holds that commit (HY-78, HY-80, HY-82), and installs nothing. `make ext`, `make test-php` and `make analyse-php` run it first |
| `make template-tag` | Fails when the template repository `TEMPLATE_REPOSITORY` has no tag `TEMPLATE_TAG` and names the expected tag and the tags that it has; `make template` runs it before the copy (HY-80) |
| `make ext` | Builds the native template extension from the C sources of the declared copy of the template repository with its build script, phpize and the php-config of `PATH`, into `build/ext/polyspec_template.so`, again only when the sources or the PHP build changed (HY-48, HY-78) |
| `make packages` | Builds the JavaScript modules and type declarations of `@polyspec/hyper` and `@polyspec/hyper-server` into their `dist` directories with the declared build of each package (`npm run build`, which runs `scripts/tsc.mjs`) and publishes the build and the npm copy of each file by file (HY-79, HY-82); the Node server tests, the board asset build, `make package-check` and `make test-scripts` run it first, because they import the packages through their exports (HY-61). The build scripts read `data-template.json`, `checkManifest` and `templateReferences` from the source of `packages/hyper-js` next to them, so they do not need `dist` and run from any working directory |
| `make package-check` | Installs both packages into `tests/package-install` offline from its `package-lock.json` with `npm ci --offline --install-links` (HY-89), type-checks its test against their declarations with `erasableSyntaxOnly` and runs it under `node` (HY-61) |
| `make server` | Builds the board server program into `examples/board/build/server` (see below) |
| `make server-fixtures` | Builds the server program of the PHP test fixtures |
| `make node-fixtures` | Builds the template files of the PHP test fixtures for the Node server tests with `scripts/build-templates.mjs` and the installed template package (HY-70) |
| `make node-server` | Type-checks and bundles the board Node server into `examples/board/build/node/server.mjs` (see below) |
| `make assets` | Builds the board client bundle and the CSR shell (see below) |
| `make test-js` | Runs the browser code tests, including the router conformance cases, and the type check |
| `make test-node` | Runs the Node server tests: the cases of the PHP server tests against the same fixtures, the JSON cases of `conformance/json.json`, sessions, the HTTP server, and the type check |
| `make test-php` | Runs the server package tests, including the router conformance cases, once with the generated program and once with the native extension |
| `make lint` | Checks PHP formatting |
| `make analyse-php` | Runs PHPStan at level `max` on the source and the tests of `packages/hyper-php` with `packages/hyper-php/phpstan.neon`, without a baseline and without ignored errors. PHPStan reads the signatures of the native template extension from `var/products/template/packages/template-php-ext/src/polyspec_template.stub.php` (HY-78) and writes its cache to `build/phpstan`. It runs with `--memory-limit=256M`, because a run without that cache needs 132 MB in its worker, above the default PHP limit of 128M |
| `make templates-check` | Checks that only the layout template carries `hx-` attributes (HC-6), that the layout places `{# title}` and `{# data}` once, and that every region of the layout and of each route template is placed once, directly inside an element whose `id` is the region name, without block arguments (HY-3, HY-30) |
| `make test-scripts` | Runs the tests of the check scripts, such as the region placement check with a broken fixture application |
| `make virtiofs-check` | Runs the server build and the output copies in Apple `container` with the output on a virtiofs bind mount (HY-68); a target of `make check` on Darwin only (`DARWIN_TARGETS`), which fails when `container` is missing |
| `make parity` | Compares PHP documents with browser renders of document and region JSON, once with the generated program and once with the native extension |
| `make server-parity` | Runs the parity steps against the PHP server and the board Node server and compares the status, the headers and the body of every response, with the browser comparison of `make parity` (HY-55) |
| `make bundle-size` | Prints the sizes of the SSR script, the CSR shell and the largest template with their gzip limits in `config/bundle-size.json`; a size above its limit prints a `WARNING` line, on GitHub also an annotation `::warning::` and a warning in the CI summary, and the target passes |
| `make e2e` | Runs the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers and a database of the run (`scripts/run-e2e.mjs`) |
| `make owner-check` | Runs the owners of the changed paths that `config/owner-checks.json` declares; `PATHS` names the paths and `BASE` takes the changes since a revision (HY-88) |
| `make owner-validate` | Fails when a tracked path has no owner or `config/owner-checks.json` names a missing target or test file (HY-88) |
| `make documents-check` | Checks the documents of `config/documents.json`: translation pairs, the `doc-id` and `source-sha256` markers, links, code blocks, the changelog and the checklist |
| `make commits-check` | Checks the commit messages of `RANGE` (the last commit by default) against `config/commits.json` |
| `make hooks` | Sets `core.hooksPath` to `.githooks`, writes the pre-push hook and runs `make hooks-check` (see [Push](#push)) |
| `make hooks-check` | Fails while `core.hooksPath` is not `.githooks` or `.githooks/pre-push` is missing, not executable or changed |
| `make push-gate-commit` | Fails when the commit `COMMIT` (`HEAD` by default) has a checklist task in progress or does not track `.githooks/pre-push` with mode 100755 (see [Push](#push)) |
| `make ci-targets` | Runs the make targets `TARGETS` to their ends and writes the report `CI_REPORT` (see [CI](#ci)) |
| `make ci-summary` | Writes the summary of the report `CI_REPORT` and the job summary (see [CI](#ci)) |
| `make ci-passed` | Fails unless every job of `RESULTS`, the JSON of `needs`, has the result `success` (see [CI](#ci)) |
| `make install-browser` | Installs the Chromium of the pinned Playwright and, on Linux, its system libraries; a download through `$(ONLINE)` (HY-89) |
| `make serve-demo` | Serves SSR, CSR and the comparison page on the fixed ports 8080 to 8082 while it holds the lock `/tmp/hyper-serve-demo.lock`; a second demo fails with the holder (see [Deployment](deployment.md)) |
| `make serve-demo-unlock` | Removes the lock of a demo whose process has ended; fails while the demo runs |
| `make bench-server-smoke` | Runs the PHP benchmark once per measurement; `make check` includes it so that a change that breaks the benchmark fails |
| `make bench` | Runs `make bench-server` and `make bench-browser`, which report server and browser performance (see [Benchmark](benchmark.md)); they are not part of `make check` |
| `make check` | Runs every check above through the guard of the full run (see below) |
| `make rerun-failed` | Reruns only the targets of `make check` that did not pass on the current tree (see below) |

## Full run

The full suite runs on GitHub after the push of `main` (see [CI](#ci)); no local full run is required before a commit or a push. A local `make check` is the only run of `make virtiofs-check`, which belongs to the full suite on Darwin only, so the virtiofs cases of HY-68 run only when someone runs `make check` on a Mac.

`make check` runs once per committed tree and commit of the template tag `TEMPLATE_TAG` (HY-80), whose native extension sources the run builds, when no task of `docs/plans/execution-checklist.md` is `[~]`. Before any step it starts `scripts/kit/full-run.mjs run --key template=<commit of the tag> <targets>`, which prints its decision with the reason (`[full-run] run: ...` or `[full-run] refuse: ...`) and refuses with status 1:

- while a task row of the checklist (`config/checklist.json`) is `[~]`; the refusal lists each active ID with its task;
- while tracked files have uncommitted changes or untracked files are not ignored (`git status --porcelain --untracked-files=all`), because a full run verifies a committed tree;
- when `var/full-run.json` records a full run of the current tree (`git rev-parse HEAD^{tree}`) with the same key `template`, the commit of the template tag, which the Makefile reads from `TEMPLATE_REPOSITORY` and `TEMPLATE_TAG`; the refusal names that run with its tree, its keys, its start time and its result;
- while the pre-push hook is not installed (`make hooks-check`); the refusal names `make hooks`;
- while the process of an `incomplete` record still runs, or another full run holds `var/full-run.lock`.

The guard runs each target of `CHECK_TARGETS` with `make -k <target>` to its end, also after a target fails, and prints `[full-run] start <target> (<n>/<total>)` and `[full-run] <target> passed|failed in <seconds>`; no target has a time limit. The output of each target is also written to `var/report/full-run/targets/<target>.log`. The guard writes `var/full-run.json` before and after each target: the tree, the commit, the keys, the process, the start and end times, the result (`incomplete` until the last target ends, then `passed` or `failed`), the failed targets and each target with its status (`pending`, `running`, `passed`, `failed`), its times and its elapsed milliseconds, and for a failed target its last 20 output lines (`lastLines`), which the guard also prints with the failed target before the result (HY-84). A run that is stopped therefore stays recorded as `incomplete`, with the target that was running. `var/` is ignored by Git, so each checkout and worktree has its own record. A commit that changes the tree or a template tag at another commit permits a new full run when no task is `[~]`.

`make rerun-failed` reruns only the targets of the current tree and template commit that did not pass: the failed targets and the targets that an `incomplete` run did not finish. It is refused like `make check` for a task in progress, uncommitted changes and a running process, and also when there is no record, when the record belongs to another tree or template commit and when the full run of the tree passed. It writes each rerun into `reruns` of the record; when every target has passed, the result of the tree becomes `passed`.

A new checkout has no record, so `make check` runs there when no task is `[~]` and the tree is clean.

## Push

A push happens only when no task of the checklist is `[~]`, neither in a pushed commit nor in the working tree. The tracked pre-push hook `.githooks/pre-push`, which `make hooks` writes, runs `node scripts/kit/push-gate.mjs hook`, which reads the refs of the push from its input, parses the checklist of every pushed commit (`git show <sha>:docs/plans/execution-checklist.md`) and of the working tree with the trackers of `config/checklist.json`, and refuses the push with status 1. The refusal names each active ID with its task and the ref and commit or the working tree that holds it, states the rule and says to complete each task or to mark it `[!]` with its cause and retry condition. A pushed commit without the checklist, and a checklist that cannot be parsed, also refuse the push.

Git does not install hooks from a clone. Every `make` run therefore sets `core.hooksPath` to `.githooks` in a checkout that tracks `.githooks/pre-push`, and `make hooks` sets it explicitly and writes the hook. `make hooks-check` and the guard of the full run fail while `core.hooksPath` is not `.githooks` or the hook is missing, not executable or differs from the hook of the tool. `make push-gate-commit COMMIT=<sha>` runs the same gate on a commit, for a push that skipped the hook, and the CI group `docs` runs it on the pushed commit.

## Publishing main

Until version 0.1 this repository has no pull request, no merge queue and no GitHub ruleset (HY-94). A change is checked by the unit tests that own it, each task of the checklist becomes `[o]` in its own commit, and `main` is pushed once, when every task is `[o]`:

```sh
git push origin main
```

The push of `main` runs `.github/workflows/ci.yml`, the full suite (see [CI](#ci)); its last job `ci-passed` passes only when every other job passed. A release tag is set on a commit of `main` only after `ci-passed` succeeded for that commit (see [Tag releases](#tag-releases)).

## Tag releases

A release is a tag `vX.Y.Z` of a commit of `main` (HY-95, the procedure in `AGENTS.md`). The push of the tag runs `.github/workflows/release.yml`, whose steps run `scripts/kit/release.mjs`, configured by `config/release.json`, in this order and stop at the first failure:

```sh
make release-verify
make release-versions
make release-assets
make release-publish
```

`make release-verify` requires the tagged commit on `origin/main` and the latest check run `ci-passed` of the commit (`gh api repos/<repository>/commits/<sha>/check-runs`) completed with the conclusion `success`. `make release-versions` requires X.Y.Z in every manifest that `config/release.json` lists in `manifests` (`package.json`, the three npm packages, `packages/hyper-php/composer.json` and `packages/hyper-python/pyproject.toml`) and the section `## X.Y.Z` in `CHANGELOG.md` and `CHANGELOG.ko.md`, and names each file with its version and the version of the tag. `make release-assets` builds the packages (`make packages`) and writes `polyspec-hyper-npm-X.Y.Z.tgz`, `polyspec-hyper-server-npm-X.Y.Z.tgz`, `polyspec-hyper-build-npm-X.Y.Z.tgz` and `polyspec-hyper-php-X.Y.Z.zip` into `var/release/assets`; an archive is named `<package>-<language>-<version>.<ext>`, with `@scope/` and `vendor/` written as `scope-` and `vendor-`. `make release-publish` creates the GitHub Release with the archives and the section as notes when it has at most 125000 characters, the limit of GitHub; a longer section becomes the one line `The changes of X.Y.Z are listed in [CHANGELOG.md](https://github.com/polyspec/hyper/blob/<tag>/CHANGELOG.md#<anchor>).`, which links `CHANGELOG.md` at the tag with the anchor of the section: the id of an `<a id="...">` line above the heading, or else the version without its dots. The Python package `packages/hyper-python` has no archive: a consumer installs it from the tag with `pip install "polyspec-hyper @ git+https://github.com/polyspec/hyper@vX.Y.Z#subdirectory=packages/hyper-python"`, which `make release-proof` runs after the release exists. The job sets up Node.js, Python, PHP, the template repository at `TEMPLATE_TAG` and `make install` as the job `check` of `ci.yml` does; the tag reaches the steps through the environment variable `TAG`. `make release-coverage` fails for a tracked manifest that `config/release.json` lists neither in `manifests` nor in `notReleased` with its reason, here `tests/package-install/package.json`, the two consumer projects of `tests/release-install`, `examples/board/composer.json` and the private root `composer.json`.

The published manifests are the manifests of the tree, and `make release-assets` packs them unchanged (HY-95). A published manifest names every polyspec package by an exact version: `packages/hyper-js/package.json`, `packages/hyper-node/package.json` and `packages/hyper-build/package.json` require `@polyspec/template` (and `packages/hyper-build/package.json` also `@polyspec/template-compiler`) at the version of the template release and `@polyspec/hyper` at the version of the release, and `packages/hyper-php/composer.json` declares `version`, requires `polyspec/template` at the version of the template release and has no `repositories`. `make release-assets` fails and names the archive, the field, the package and its value when a packed manifest names a polyspec package by a `file:`, `link:` or `workspace:` path, a git, `github:` or ssh source, a URL, a range or `@dev`, when a zip declares `repositories` or lacks the version of the tag, and when a packed manifest differs from its source manifest. The tests of this behavior are in `tests/kit/release.test.mjs`.

`make release-consumer TAG=vX.Y.Z` installs the archives of `var/release/assets` as a consumer does, in temporary directories outside the repository, from the committed projects of `tests/release-install` with an empty cache: `npm/package.json`, which depends on the release tarballs of this repository by `file:` and on the tarballs of the template release by their URLs, with its `package-lock.json`, is installed with `npm ci` and the scope `@polyspec` pointed at the unreachable registry `http://127.0.0.1:9/`, so a polyspec package of this repository comes only from its tarball and the template tarballs and the third-party packages are downloaded as the lock pins them; and `composer/composer.json` with an `artifact` repository `artifacts` of the release zip of this repository and a `package` repository of the zip of the template release, and its `composer.lock`, is installed with `composer install`. Each installed package then runs its smoke command of `config/release.json`: the npm packages are imported, the bins `hyper-build-server` and `hyper-build-assets` of `@polyspec/hyper-build` load all their imports and stop at their first argument check, and the class `Polyspec\Hyper\App` of the Composer package loads. `make release-consumer-lock TAG=vX.Y.Z` writes both manifests and locks from the archives; a lock names a tarball or a zip of this repository without its integrity or shasum, because the archive is built in the same run, so a lock changes only with a release version or a dependency, and the release commit runs the target.

npm 12.2.0 refuses to write the lock of the npm consumer project under `allow-remote=root`: while it builds a lock, it counts the registry tarball of a package with `bundleDependencies`, here `@tailwindcss/oxide-wasm32-wasi` below `@tailwindcss/oxide`, as a remote package and fails with `EALLOWREMOTE` ([npm/cli#9818](https://github.com/npm/cli/pull/9818)). npm has no allow list of URLs, so the Makefile runs `make release-consumer-lock` with `npm_config_allow_remote=all`; the install of the consumer needs no setting and installs only what the lock pins by its integrity. The setting is removed when the npm release of `packageManager` contains npm/cli#9818 (H13.5-14). In the consumer install, npm blocks the `postinstall` script of esbuild, because the consumer allows no install script; esbuild runs from its platform package, such as `@esbuild/darwin-arm64`, which npm installs as an optional dependency, and `@tailwindcss/oxide` has no install script.

### Development layout

The private roots resolve the packages in the checkout and are never published. The root `package.json` declares `@polyspec/hyper`, `@polyspec/hyper-server` and `@polyspec/hyper-build` as `file:` copies of `packages/hyper-js`, `packages/hyper-node` and `packages/hyper-build` and `@polyspec/template` and `@polyspec/template-compiler` by the URLs of the tarballs of the template release, with `overrides` that make the exact versions of the packages resolve to these copies and to the template tarballs, and `.npmrc` sets `allow-remote=root`, because npm 12 installs no URL dependency by default; it has no npm workspaces, because npm always links a workspace (HY-79). The root `composer.json` installs into the root `vendor` from the path repository `var/products/hyper-php` and from a `package` repository of the zip of the template release with its sha1 `shasum`, and maps the namespaces of `packages/hyper-php` to the tree; `composer.lock` is its lock. Both roots take the template release v0.0.4 (HY-70), the tag `TEMPLATE_TAG` of the Makefile whose native extension sources `make template` copies (HY-80).

### Installing the release assets

A consumer downloads the assets of the releases that it needs and installs them together; no registry is needed. With npm, the consumer lists every tarball as a `file:` dependency, and each exact version of a packed manifest is satisfied by the tarball installed beside it:

```json
{
  "dependencies": {
    "@polyspec/hyper-server": "file:polyspec-hyper-server-npm-X.Y.Z.tgz",
    "@polyspec/hyper-build": "file:polyspec-hyper-build-npm-X.Y.Z.tgz",
    "@polyspec/hyper": "file:polyspec-hyper-npm-X.Y.Z.tgz",
    "@polyspec/template": "file:polyspec-template-T.T.T.tgz",
    "@polyspec/template-compiler": "file:polyspec-template-compiler-T.T.T.tgz"
  }
}
```

With Composer, the consumer puts the zips `polyspec-hyper-php-X.Y.Z.zip` and `polyspec-template-T.T.T.zip` into one directory and declares it as an `artifact` repository; the zips resolve each other by name and version:

```json
{
  "repositories": [{ "type": "artifact", "url": "release-assets" }],
  "require": { "polyspec/hyper": "X.Y.Z" }
}
```

T.T.T is the version of `@polyspec/template` that `packages/hyper-js/package.json` of the release requires. A consumer that builds its application installs `@polyspec/hyper-build` and runs its bins from `node_modules/.bin` (HY-96, [Server build](#server-build), [Asset build](#asset-build)).

## CI

The workflow `.github/workflows/ci.yml` runs the full suite for the push of `main` and every manual run (`workflow_dispatch`) (HY-91, see [Publishing main](#publishing-main)). Its job `check` has one matrix entry per CI group, with `fail-fast: false`, and each entry names the targets that it runs:

| Entry | Targets | Setup |
|---|---|---|
| `docs` | `kit-check`, `kit-test`, `documents-check`, `hooks-check`, `push-gate-commit`, `commits-check`, `owner-validate` | Node.js, Python |
| `php` | `dependency-policy-mutation-check`, `bench-server-smoke`, `lint`, `analyse-php`, `test-php` | Node.js, Python, PHP, the template checkout, `make install` |
| `node` | `templates-check`, `test-scripts`, `test-js`, `test-node`, `package-check` | Node.js, Python, PHP, the template checkout, `make install` |
| `board` | `parity`, `server-parity`, `bundle-size`, `e2e` | Node.js, Python, PHP, the template checkout, `make install`, `make install-browser` |
| `python-3.11`, `python` | `test-python` | Node.js, Python 3.11 and the Python of `.python-version` |

Each step runs one make target (HY-90) and every step after the first runs after a failed step. The workflow sets up Node.js, Python and PHP from `.node-version`, `.python-version` and `.php-version` and checks out the template repository at the tag `TEMPLATE_TAG` of the Makefile as `../template`, from which `make install` copies the native extension sources. `make ci-targets TARGETS="<targets>" CI_REPORT=var/ci/<name>` runs every target of the entry with its own `make -k <target>` to its end and writes the report. `make ci-summary CI_REPORT=var/ci/<name>` writes the job summary. The job uploads the artifact `ci-<name>-<run id>-<attempt>`, the directory `var/ci/<name>/`:

- `summary.md`: the tree, the running releases of Node.js, npm, PHP with its patch, Composer and make, the outcome of each setup step, and a table of the targets with their status, time and first failure lines, followed by the first failure lines of each failed target;
- `record.json`: the same as data, written before and after each target, so a runner that stopped leaves the target that was running;
- `targets/<target>.log`: the command and the full output of each target and how make ended.

The last job `ci-passed` runs after every other job and runs `make ci-passed RESULTS='<JSON of needs>'`, which prints the result of every needed job and fails unless each one is `success`. A job added to `ci.yml` is listed in `needs`; `tests/scripts/ci-workflow.test.mjs` fails when `ci-passed` is missing, is not the last job, lacks `if: ${{ always() }}`, does not need every other job, runs on another runner or runs another step.

## Test runs

`scripts/kit/run-tests.mjs <node|vitest|go|cargo|phpunit> [--timeout <seconds>] [--cwd <directory>] [--php-extension <file>] [--] [<arguments>]` runs a test tool, and `make test-js`, `make test-node`, `make test-php`, `make test-scripts` and `make package-check` run their tests through it; PHPUnit is the one of the vendor directory of `COMPOSER_VENDOR_DIR`, which `make test-php` sets to the root `vendor`. Every test prints a line when it starts, a line every 5 seconds while it runs and a line with its result and elapsed time, and the run ends with a line of the counts and the elapsed time. Every test has its own timeout, 30 seconds unless `--timeout` sets another: vitest and `node --test` fail the test at its timeout, and for PHPUnit, which `--teamcity` makes report each test, the runner stops PHPUnit and fails the test by its name. `--php-extension` loads a PHP extension into PHPUnit. `tests/kit/run-tests.test.mjs` tests the runner and its reporters.

To run the tests that own a change, pass their files or a filter, for example `node scripts/kit/run-tests.mjs vitest --cwd packages/hyper-js tests/router.test.ts` or `COMPOSER_VENDOR_DIR=$PWD/vendor node scripts/kit/run-tests.mjs phpunit --cwd packages/hyper-php -- --filter RouterTest`.

## Servers of a run

`make parity` and `make server-parity` start their own servers with `scripts/board-servers.mjs`: every server listens on a port that the system assigns, and the check sends its requests to the address that the server reports in its output (`Development Server (http://127.0.0.1:<port>) started` of PHP, `board on http://127.0.0.1:<port>` of the board Node server, `edge http://127.0.0.1:<port>` of `scripts/serve-edge.mjs`). A request therefore reaches a server of the same run, also while a run from another checkout or session runs. Starting a server is a step without a time limit: it prints its start, every output line of the server with the prefix `[<name>]` and its address with the elapsed time, and fails when the server exits first. The databases and the session directory of a run lie in a temporary directory, which `scripts/check-parity.mjs` prints as `run directory: <path>` and removes.

`make e2e` runs `scripts/run-e2e.mjs` in the same way: it starts the board example in both rendering modes (the API origin, the edge and the SSR origin) on an empty database in its run directory, and runs `playwright test` with the addresses in `HYPER_E2E_SSR` and `HYPER_E2E_CSR`, which `tests/e2e/origins.ts` requires; its arguments are passed to Playwright, for example `node scripts/run-e2e.mjs -g 'stylesheet'`. Playwright starts no server itself. `make bench-browser` starts its servers and its database in the same way.

## Server build

`hyper-build-server --manifest <app.json> --templates <directory> --output <directory> --php-namespace <namespace>`, a bin of the build package `@polyspec/hyper-build` (HY-96), writes the server program (HY-48); `make server` runs it from the checkout as `node packages/hyper-build/bin/hyper-build-server.mjs`:

1. `templates/`: every template of the application and the reserved template `hyper/data.tpl`. The native extension reads these files.
2. `program.php`: the generated PHP program of the same templates, compiled with the compiler package `@polyspec/template-compiler` that `@polyspec/hyper-build` requires (HY-70) into the given PHP namespace (`Polyspec\Hyper\Examples\Board\Program` for the board). `program.json` records the namespace, which the renderer reads. Every template renders as a target, and every definition is HTML, because the server renders each region alone.
3. `reads.json`: the read paths of every route, computed with `routeReads` of `@polyspec/hyper` (HY-73).

PHP renders with the native extension when it has loaded `polyspec_template`, and otherwise with `program.php`. Both outputs are built from the same sources, so a server can switch by loading or not loading the extension.

## Node server

`make node-server` bundles `examples/board/node/main.ts` with esbuild into `examples/board/build/node/server.mjs`. The board Node server serves the same application as `examples/board/public/index.php`, with `node:sqlite` for the posts, and serves the files of `examples/board/public`:

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0` lets the system assign the port; the server prints `board on http://127.0.0.1:<port>` with the port that it listens on. `BOARD_SESSIONS` is an absolute session directory, and `BOARD_BASE_PATH`, `BOARD_HTTPS` and `BOARD_FRAME_ANCESTORS` have the meaning that they have for PHP. `BOARD_TIME`, for both servers, fixes the creation time of new posts in Unix seconds, so that `make server-parity` compares the same posts. The Node server renders with the template files of `make assets` (HY-54).

## Asset build

`hyper-build-assets --app <directory> --api <base path> --output <directory>`, a bin of `@polyspec/hyper-build` (HY-96), writes the following outputs with the template package `@polyspec/template` that the build package requires (HY-70); `make assets` runs it from the checkout as `node packages/hyper-build/bin/hyper-build-assets.mjs`. Below `public/assets/` it only adds files whose names hold a hash of their content and removes none; the outputs without a hash lie in the directory of `--output` (HY-34). `make assets` passes `examples/board/build`.

1. `public/assets/templates/<name>.<hash>.json`: one AST file per template under `templates/`, and one for the reserved template `hyper/data.tpl` (HY-34).
2. `<output>/templates.index.json`: each template name with its file URL (HY-34). The client imports it as `@polyspec/hyper/templates-index`.
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js` and `<output>/manifest.json`: the client entry, one chunk file per code that the entry imports with `import()` only, which the browser loads when that code first runs, and the URL of the entry as `hyper`, which the server passes to the layout (HY-76). The entry contains htmx, the hyper browser code, the template render runtime, `app/app.json` and the index, and no template. The build writes no file that the application names; the application places and links its own stylesheets.
4. With `--tailwind <source>=<output>`, the output stylesheet: the source compiled with the theme of Tailwind CSS and the utility classes that the files below `templates/` and `client/` use, with the rules of the source in the layer `components` and no rule of the layer `base` (HY-77). Tailwind CSS is a dependency of `@polyspec/hyper-build`, so an application that writes its lock with npm 12.2.0 under the default `allow-remote=none` meets the npm defect of [Tag releases](#tag-releases): npm refuses the tarball of `@tailwindcss/oxide-wasm32-wasi` with `EALLOWREMOTE` ([npm/cli#9818](https://github.com/npm/cli/pull/9818)) until an npm release contains the fix.
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

The limits of the SSR script and the CSR shell in `config/bundle-size.json` are the measured gzip sizes plus about 1 %, rounded up to 100 bytes. A size above its limit is a warning, not a failure (AGENTS); a change that makes an output larger than its limit changes the limit in the same change and states why the growth is needed; a change that makes an output smaller lowers the limit by the same rule.

The browser loads only the templates that its rendering reaches (HY-35), and a template file is cached by its hashed name. The AST of a template is about twice the size of its source after compression, because every node records its source span. `config/bundle-size.json` limits a template file to 4,096 gzip bytes, so a template that grows past it is split into blocks.
