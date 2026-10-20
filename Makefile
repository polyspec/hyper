# The shared tools are the npm package @polyspec/kit, which package.json pins by the URL of its release asset and
# package-lock.json by its integrity. scripts/kit/kit-bootstrap.mk is a copy that `make kit-sync` writes from the package
# and that is never edited here; it includes the kit.mk of the package, which defines the targets of the toolchain, the
# Git hooks, the push gate, the documents, the owner checks, the CI report, the release and the dependency review, and
# sets KIT to the dist of the package and KIT_EXT to mjs. A checkout starts with `make install-tools TOOLS=npm` and
# `make install-packages`. This repository differs from another only in config/*.json and in the targets below.
include scripts/kit/kit-bootstrap.mk

BOARD := examples/board
PHP_PACKAGE := packages/server/php
JS_PACKAGE := packages/client
NODE_PACKAGE := packages/server/ts
BUILD_PACKAGE := packages/build
PYTHON_PACKAGE := packages/server/python
# The Python of the checks is the python of mise.toml, which `make install-tools` installs with mise at the digest of mise.lock
# and its shim runs (HR-81, kit K127). requires-python >= 3.14 states the tested minor of the package (H20.12).
# The absolute path, as NPM and COMPOSER have, because make looks up a recipe line on its own PATH.
# The virtual environment of the Python server package: make hyper-install makes it from the Python of mise.toml with kit's
# python-venv and installs the package into it in editable mode with its dependencies, the template wheel of the release
# included, so the tests and the board Python server import the installed packages and read no source path (S5).
PYTHON_VENV := $(CURDIR)/$(PYTHON_PACKAGE)/.venv
UV := $(CURDIR)/var/tools/mise/shims/uv
# The Python of that venv, which scripts/board-servers.mts starts the board Python server with.
export HYPER_PYTHON := $(PYTHON_VENV)/bin/python
# npm installs the template packages @polyspec/template and @polyspec/template-compiler from the tarballs of the template
# release that package.json names (HR-70). config/release-assets.json pins the php zip and the php-ext archive of the same
# release with their sha256: make hyper-install fetches both with make release-assets-fetch of kit (K140), which puts the php zip
# into the Composer artifact repository var/products/template-php, from which Composer installs polyspec/template (H23.11),
# and unpacks the native template extension (H14.1-7, H23.11-2).
# The template repository of TEMPLATE_REPOSITORY is read only for the commit of TEMPLATE_TAG in the full-run key (HR-80);
# TEMPLATE_TAG is the tag of the version of the entry template-php, its one declaration.
TEMPLATE_REPOSITORY := ../template
TEMPLATE_TAG = v$(shell $(NODE) $(KIT)/release-assets.$(KIT_EXT) version template-php)
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The Composer vendor directory of the private root composer.json, which installs packages/server/php for development.
PHP_VENDOR := $(CURDIR)/vendor
# The native template extension, built from the unpacked php-ext asset (HY-48, H14.1-7).
# The lock of `make serve-demo`, whose fixed ports exist once on this machine (holder-lock of @polyspec/kit).
SERVE_DEMO_LOCK := /tmp/hyper-serve-demo.lock
# The TypeScript compiler of the bin link that npm writes (HR-79), by its absolute path, as NPM and COMPOSER.
TSC := $(CURDIR)/node_modules/.bin/tsc
# The esbuild package replaces bin/esbuild with the executable of the platform when it installs.
ESBUILD := node_modules/esbuild/bin/esbuild
# The path repository packages/server/php, which the board links with Composer (HR-79).
# The PHP memory limit of PHPStan: a run without its result cache (build/phpstan) needs 132 MB in its worker, above
# the default limit of 128M.
PHPSTAN_MEMORY := 256M
# The library that `make ext` builds from the unpacked php-ext asset, which `make hyper-install` fetches (H14.1-7).
EXT := build/ext/polyspec_template.so

# The toolchain (HR-81, install-tools of @polyspec/kit): npm and Composer of this checkout, which `make install-tools`
# installs into var/tools, come first on PATH for every recipe and the programs that it starts.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
# A check reads no network (HR-89): `make hyper-install` downloads everything that the checks read, and every other recipe
# and the programs that it starts run npm and Composer offline, so a missing download fails at once instead of
# reaching a registry in one run and not in another. The downloads of `make install-tools`, `make hyper-install` and
# `make hyper-install-browser` lift the settings with $(ONLINE).
export npm_config_offline := true
export COMPOSER_DISABLE_NETWORK := 1
ONLINE := env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK
# make 3.81 looks up the program of a recipe line without shell syntax on its own PATH, not on the exported one, so the
# recipes start npm by the absolute path of var/tools/bin and Composer, a tool of mise.toml, by that of its shim.
NPM := $(CURDIR)/var/tools/bin/npm
COMPOSER := $(CURDIR)/var/tools/mise/shims/composer
# The lock of the package manager installs of this checkout: one npm or Composer install at a time (HR-82).
INSTALL_LOCK := var/install.lock

# A recipe with several checks runs every check to its end (HR-86): `$(call check,<name>,<command>)` prints the command,
# runs it through scripts/line-end.mts, which ends its output with a newline so the next line starts at column 0
# (HR-84), and records the name when it fails, and `$(checks_result)` then fails and names every failed
# check. A recipe that uses them starts with `@failed=; \` and joins its checks with `\`.
check = echo '$(2)'; $(NODE) scripts/line-end.mts '$(2)' || failed="$$failed $(1);";
checks_result = test -z "$$failed" || { echo "failed checks:$$failed"; exit 1; }

.DEFAULT_GOAL := help

.PHONY: help hyper-install hyper-install-python hyper-install-browser hyper-test-node hyper-test-python-render hyper-test-scripts check typecheck hyper-server-php-install template-tag ext packages package-check server server-fixtures node-server node-fixtures assets hyper-test-js hyper-test-php hyper-test-python hyper-lint analyse-php templates-check virtiofs-check parity server-parity server-parity-python bundle-size e2e serve-demo bench-server bench-server-smoke bench-browser bench serve-demo-unlock

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

hyper-install: install-kit ## Install the pinned tools, fetch the archives of the template release and install the Composer dependencies; make install-packages installs the npm packages (HR-89, H14.1-7)
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT)
	$(MAKE) --no-print-directory release-assets-fetch
	$(MAKE) --no-print-directory hyper-install-python
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER) install
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER) install --working-dir=$(BOARD)

hyper-install-python: ## Make the venv of the Python server package and install the package into it in editable mode with its dependencies (S5)
	$(MAKE) --no-print-directory python-venv DIR=$(PYTHON_VENV)
	$(ONLINE) $(UV) sync --quiet --locked --project $(PYTHON_PACKAGE)

hyper-install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HR-91)
	$(ONLINE) $(NODE) node_modules/@playwright/test/cli.js install --with-deps chromium

install: hyper-install

test: hyper-test-js hyper-test-node hyper-test-php hyper-test-python hyper-test-python-render hyper-test-scripts

lint: hyper-lint

# The release of hyper reads the template repository at TEMPLATE_TAG next to this checkout, and the installed dependencies:
# the release workflow that kit vendors runs make release-prepare before release-tools (kit K132), and this rule checks the
# template out where CI checks it out, fails on a checkout without the tag, and installs (H23.7).
release-prepare:: ## Check out the template repository at TEMPLATE_TAG into TEMPLATE_REPOSITORY and install, for a release; ONLINE
	test -d $(TEMPLATE_REPOSITORY) || $(ONLINE) git clone --quiet --depth 1 --branch $(TEMPLATE_TAG) https://github.com/polyspec/template.git $(TEMPLATE_REPOSITORY)
	$(MAKE) template-tag
	$(ONLINE) $(MAKE) hyper-install

# Fails when the template checkout has no tag TEMPLATE_TAG; the full-run key names that commit (HR-80).
template-tag: ## Fail when the template repository TEMPLATE_REPOSITORY has no tag TEMPLATE_TAG, naming the expected tag and the tags it has (HR-80)
	@git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}' >/dev/null || { \
	  echo "template-tag: $(TEMPLATE_REPOSITORY) has no tag $(TEMPLATE_TAG): expected the tag $(TEMPLATE_TAG), actual tags: $$(git -C $(TEMPLATE_REPOSITORY) tag --list 2>/dev/null | tr '\n' ' ')" >&2; \
	  echo "template-tag: fetch the tags of the template repository with git -C $(TEMPLATE_REPOSITORY) fetch --tags" >&2; \
	  exit 1; }

# The build (scripts/build-template-ext.mts) runs phpize, configure and make of the unpacked asset with the php-config of PATH in
# a temporary directory, builds again only when the sources or the PHP build changed, and publishes the library with a
# rename (HR-82). It runs offline: `make hyper-install` fetched the asset.
ext: toolchain-check ## Build the native template extension from the unpacked php-ext asset with phpize of the PHP of PATH into build/ext (HY-48, H14.1-7)
	$(NODE) scripts/build-template-ext.mts $(CURDIR)/$(EXT)

packages: toolchain-check ## Build the JavaScript modules and type declarations of the npm packages into their dist directories; npm links the workspaces (HR-61, HR-79, HR-96)
	cd $(JS_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist
	cd $(NODE_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist

# The path repository of the board links the PHP server package to packages/server/php (Composer's default, HR-79), so the
# board runs the current source without a copy. The install reads no registry.
hyper-server-php-install: ## Install the Composer dependencies of the board, which link polyspec/hyper-server to packages/server/php (HR-79)
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER) install --no-interaction --working-dir=$(BOARD)

package-check: packages node-fixtures ## Install the npm packages into tests/package-install, type-check its test against their declarations and run it under node (HR-61)
	cd tests/package-install && $(NODE) ../../$(KIT)/holder-lock.$(KIT_EXT) run ../../$(INSTALL_LOCK) -- $(NPM) ci --offline --allow-remote=root --no-audit --no-fund
	$(TSC) -p tests/package-install/tsconfig.json
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node --cwd tests/package-install -- package-install.test.ts

server: packages hyper-server-php-install ## Build the board server program: its templates and the generated PHP program (HY-48)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

server-fixtures: packages ## Build the server program of the PHP test fixtures
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --php-namespace 'Polyspec\Hyper\Tests\Program'

node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: packages ## Build the template files of the PHP test fixtures for the Node server tests
	$(NODE) scripts/build-templates.mts --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-assets.mjs --app $(BOARD) --api /api --output $(BOARD)/build --static public/assets/app.css --static public/assets/reader.css

hyper-test-js: toolchain-check ## Run the browser code tests, including the router conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(JS_PACKAGE),node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(JS_PACKAGE)$(if $(JS_TESTS), -- $(JS_TESTS))) \
	$(call check,the type check of $(JS_PACKAGE),$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json) \
	$(checks_result)

hyper-test-node: packages node-fixtures ## Run the Node server tests, including the PHP AppTest cases and the JSON conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(NODE_PACKAGE),node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE)) \
	$(call check,the type check of $(NODE_PACKAGE),$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json) \
	$(checks_result)

hyper-test-php: server-fixtures ext ## Run the server package tests with the generated program and with the native extension
	@failed=; \
	$(call check,PHPUnit with the generated program,COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE)) \
	$(call check,PHPUnit with the native extension,COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) --php-extension $(EXT)) \
	$(checks_result)

hyper-test-python: toolchain-check ## Run the Python server package tests, which read the conformance cases of routes, rest, csrf, fields and json
	$(PYTHON_VENV)/bin/python $(PYTHON_PACKAGE)/tests/run.py; unit=$$?; $(PYTHON_VENV)/bin/python -m unittest discover -s tests/python_package -p 'test_*.py'; package=$$?; test $$unit -eq 0 -a $$package -eq 0

# The rendering tests need the template Python package (H15.3-3), the wheel of the template release that the venv of make
# install holds, and `make server-fixtures` writes the server program they open.
hyper-test-python-render: server-fixtures toolchain-check ## Run the Python rendering tests with the template package of the venv (H15.3-3)
	$(PYTHON_VENV)/bin/python $(PYTHON_PACKAGE)/tests/run.py $(PYTHON_PACKAGE)/tests/render 'render_*.py'

hyper-lint: toolchain-check ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: ext ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	$(NODE) scripts/check-templates.mts --app $(BOARD)

# The TypeScript of scripts/, tests/ and benchmarks/ (tsconfig.json), which Node runs by type stripping and so never checks
# itself (S9 of kit). scripts/check-parity.mts imports the types of @polyspec/hyper-client, which the package's build writes
# to its dist, so packages runs first.
typecheck: packages ## Check the types of the TypeScript of scripts/, tests/ and benchmarks/ with the tsc of node_modules (tsconfig.json)
	$(TSC) -p tsconfig.json

hyper-test-scripts: packages ## Run the tests of the check scripts, or only the files of TESTS
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- $(or $(TESTS),tests/scripts/)

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	@failed=; \
	$(call check,parity with the generated program,node scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json) \
	$(call check,parity with the native extension,node scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --extension $(EXT)) \
	$(checks_result)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node

# The Python server renders with the template Python package of the template checkout (H15.3-3), so this comparison
# runs where that checkout exists.
server-parity-python: assets server ## Compare the Python server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --python

bundle-size: assets ## Print the sizes of the SSR script, the CSR shell, the chunks and the largest template with their gzip limits; a size above its limit is a warning, never a failure
	$(NODE) scripts/check-bundle-size.mts --app $(BOARD) --output $(BOARD)/build --limits config/bundle-size.json$(if $(filter true,$(GITHUB_ACTIONS)), --annotations)

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run
	$(NODE) scripts/run-e2e.mts

virtiofs-check: toolchain-check ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HR-68); a target of the full suite on Darwin
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- tests/virtiofs/

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	$(NODE) scripts/serve-demo.mts --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) clear $(SERVE_DEMO_LOCK)

bench-server: server ext ## Measure PHP request handling and rendering cost per row count, with the generated program and with the native extension
	@failed=; \
	$(call check,the benchmark with the generated program,php benchmarks/server.php --app $(BOARD) --iterations 300) \
	$(call check,the benchmark with the native extension,php -d extension=$(abspath $(EXT)) benchmarks/server.php --app $(BOARD) --iterations 300) \
	$(checks_result)

bench-browser: assets server ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	$(NODE) benchmarks/browser.mts --runs 15

bench-server-smoke: assets server ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php benchmarks/server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser ## Run both measurements; results are reports, not pass or fail checks

# The targets of the full suite. `make check` runs them through the guard full-run of @polyspec/kit, which refuses while a
# checklist task is [~], while tracked changes are uncommitted or when var/full-run.json records a run of the current tree
# and the commit of the template tag, runs each target with `make <target>` to its end and records its result;
# `make rerun-failed` reruns the targets of the current tree that did not pass.
CHECK_TARGETS := kit-check toolchain-check layout-check typecheck lint-ts docs-check hooks-check push-gate-commit commits-check owner-validate dependency-policy-check dependency-policy-mutation-check bench-server-smoke hyper-lint analyse-php templates-check hyper-test-scripts hyper-test-js hyper-test-node hyper-test-python hyper-test-python-render package-check hyper-test-php parity server-parity server-parity-python bundle-size e2e rules-check rebuild-check language-check test-markers-check duplication-check parity-declarations-check parity-check lint-php lint-python link-state-check bypass-check

# The CI groups of the full suite (HR-91) are the entries of the matrix of .github/workflows/ci.yml: each entry runs its
# `targets` with `make ci-targets`, so the entries together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mts). An entry gathers the targets that need the same setup: docs only Node.js, php and
# node PHP, the template build and the install, board also Chromium, python only the Python of its pins.

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mts). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

# The full run is keyed by the tree and by the commit of the template tag, whose native extension sources the targets
# build (HR-80): a run of the same tree with another template commit is another run.
TEMPLATE_COMMIT = $(shell git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}')
FULL_RUN_KEYS = --key template=$(TEMPLATE_COMMIT)

check: template-tag ## Run every check through the guard: once per tree, when no checklist task is [~]
	$(NODE) $(KIT)/full-run.$(KIT_EXT) run $(FULL_RUN_KEYS) $(CHECK_TARGETS)

rerun-failed: template-tag


# The steps of .github/workflows/release.yml for the tag TAG (release of @polyspec/kit, config/release.json), in this order:
# release-verify requires the tagged commit on origin/main with the check ci-passed passed, release-versions the version of
# the tag in every manifest and its section in CHANGELOG.md, release-assets builds the packages and their archives into
# var/release/assets, and release-publish creates the GitHub Release. The targets are those of the kit.mk of @polyspec/kit; the
# archives are built from the built packages, so release-assets builds them first.
release-assets: packages

# npm 12.2.0 counts the registry tarball of a package with bundleDependencies, here @tailwindcss/oxide-wasm32-wasi below
# @polyspec/hyper-build, as a remote package while it writes a lock and refuses it under allow-remote=root with
# EALLOWREMOTE (https://github.com/npm/cli/pull/9818), so the lock of the npm consumer project is written with
# allow-remote=all. The install of the consumer projects, in release-consumer and in release-proof, uses allow-remote=root,
# which npm 12 needs for the template tarballs that the lock pins by their integrity (H13.5-14).
release-consumer-lock: export npm_config_allow_remote := all
release-consumer: export npm_config_allow_remote := root
release-proof: export npm_config_allow_remote := root
