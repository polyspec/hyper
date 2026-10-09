# The shared tools of polyspec/kit (kit.json, scripts/kit, tests/kit): a vendored copy that `make kit-sync KIT_TAG=<tag>`
# writes and that is never edited here. kit.mk defines the targets of the toolchain, the Git hooks, the push gate, the
# documents, the owner checks, the CI report, the release and the dependency review; this repository differs from another
# only in config/*.json and in the targets below.
include scripts/kit/kit.mk

BOARD := examples/board
PHP_PACKAGE := packages/hyper-php
JS_PACKAGE := packages/hyper-js
NODE_PACKAGE := packages/hyper-node
BUILD_PACKAGE := packages/hyper-build
PYTHON_PACKAGE := packages/hyper-python
# The Python of the checks is the python3 of PATH; requires-python >= 3.11 and the Python pin of
# .python-version name the release that CI runs.
PYTHON := python3
# npm installs the template packages @polyspec/template and @polyspec/template-compiler and Composer installs
# polyspec/template from the assets of the template release that package.json and composer.json name (HY-70). The
# native template extension is the php-ext asset of the same release, which config/template-ext.json pins (H14.1-7).
# The template repository of TEMPLATE_REPOSITORY is read only for the commit of TEMPLATE_TAG in the full-run key (HY-80).
TEMPLATE_REPOSITORY := ../template
TEMPLATE_TAG := v0.0.5
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The Composer vendor directory of the private root composer.json, which installs packages/hyper-php for development.
PHP_VENDOR := $(CURDIR)/vendor
# The native template extension, built from the unpacked php-ext asset (HY-48, H14.1-7).
# The lock of `make serve-demo`, whose fixed ports exist once on this machine (scripts/holder-lock.mjs).
SERVE_DEMO_LOCK := /tmp/hyper-serve-demo.lock
# npm installs every dependency as a copy and no bin link (HY-79, .npmrc), so the recipes start the tools with node.
TSC := node scripts/tsc.mjs
# The esbuild package replaces bin/esbuild with the executable of the platform when it installs.
ESBUILD := node_modules/esbuild/bin/esbuild
# The copy of packages/hyper-php that the board installs with Composer (HY-79).
HYPER_PHP_COPY := var/products/hyper-php
# The PHP memory limit of PHPStan: a run without its result cache (build/phpstan) needs 132 MB in its worker, above
# the default limit of 128M.
PHPSTAN_MEMORY := 256M
# The library that `make ext` builds from the unpacked php-ext asset, which `make install` fetches (H14.1-7).
EXT := build/ext/polyspec_template.so

# The toolchain (HY-81, scripts/kit/install-tools.mjs): npm and Composer of this checkout, which `make install-tools`
# installs into var/tools, come first on PATH for every recipe and the programs that it starts.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
# A check reads no network (HY-89): `make install` downloads everything that the checks read, and every other recipe
# and the programs that it starts run npm and Composer offline, so a missing download fails at once instead of
# reaching a registry in one run and not in another. The downloads of `make install-tools`, `make install` and
# `make install-browser` lift the settings with $(ONLINE).
export npm_config_offline := true
export COMPOSER_DISABLE_NETWORK := 1
ONLINE := env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK
# make 3.81 looks up the program of a recipe line without shell syntax on its own PATH, not on the exported one, so the
# recipes start npm and Composer by the absolute paths of var/tools/bin.
NPM := $(CURDIR)/var/tools/bin/npm
COMPOSER := $(CURDIR)/var/tools/bin/composer
# The lock of the package manager installs of this checkout: one npm or Composer install at a time (HY-82).
INSTALL_LOCK := var/install.lock

# A recipe with several checks runs every check to its end (HY-86): `$(call check,<name>,<command>)` prints the command,
# runs it through scripts/line-end.mjs, which ends its output with a newline so the next line starts at column 0
# (HY-84), and records the name when it fails, and `$(checks_result)` then fails and names every failed
# check. A recipe that uses them starts with `@failed=; \` and joins its checks with `\`.
check = echo '$(2)'; node scripts/line-end.mjs '$(2)' || failed="$$failed $(1);";
checks_result = test -z "$$failed" || { echo "failed checks:$$failed"; exit 1; }

.DEFAULT_GOAL := help

.PHONY: help install hyper-php-copy template-tag ext packages package-check server server-fixtures node-server node-fixtures assets test-js test-node test-php test-python test-python-render lint analyse-php templates-check test-scripts virtiofs-check parity server-parity server-parity-python bundle-size e2e serve-demo bench-server bench-server-smoke bench-browser bench check serve-demo-unlock install-browser

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: install-tools ## Install the pinned tools, fetch the php-ext asset of the template tag and install the npm and Composer dependencies (HY-89, H14.1-7)
	node scripts/kit/check-toolchain.mjs
	$(ONLINE) node scripts/template-ext.mjs fetch
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	$(ONLINE) node scripts/kit/holder-lock.mjs run $(INSTALL_LOCK) -- $(NPM) ci --no-audit --no-fund
	$(ONLINE) node scripts/kit/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install
	$(ONLINE) node scripts/kit/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install --working-dir=$(BOARD)

# Fails when the template checkout has no tag TEMPLATE_TAG; the full-run key names that commit (HY-80).
template-tag: ## Fail when the template repository TEMPLATE_REPOSITORY has no tag TEMPLATE_TAG, naming the expected tag and the tags it has (HY-80)
	@git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}' >/dev/null || { \
	  echo "template-tag: $(TEMPLATE_REPOSITORY) has no tag $(TEMPLATE_TAG): expected the tag $(TEMPLATE_TAG), actual tags: $$(git -C $(TEMPLATE_REPOSITORY) tag --list 2>/dev/null | tr '\n' ' ')" >&2; \
	  echo "template-tag: fetch the tags of the template repository with git -C $(TEMPLATE_REPOSITORY) fetch --tags" >&2; \
	  exit 1; }

# The build (scripts/template-ext.mjs) runs phpize, configure and make of the unpacked asset with the php-config of PATH in
# a temporary directory, builds again only when the sources or the PHP build changed, and publishes the library with a
# rename (HY-82). It runs offline: `make install` fetched the asset.
ext: toolchain-check ## Build the native template extension from the unpacked php-ext asset with phpize of the PHP of PATH into build/ext (HY-48, H14.1-7)
	node scripts/template-ext.mjs build $(CURDIR)/$(EXT)

packages: toolchain-check ## Build the JavaScript modules and type declarations of the npm packages into their dist directories and reinstall their npm copies (HY-61, HY-79, HY-96)
	cd $(JS_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && node ../../scripts/publish.mjs directory dist.next-$$$$ dist
	node scripts/publish.mjs npm-copy $(JS_PACKAGE) node_modules/@polyspec/hyper
	cd $(NODE_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && node ../../scripts/publish.mjs directory dist.next-$$$$ dist
	node scripts/publish.mjs npm-copy $(NODE_PACKAGE) node_modules/@polyspec/hyper-server
	node scripts/publish.mjs npm-copy $(BUILD_PACKAGE) node_modules/@polyspec/hyper-build

hyper-php-copy: ## Write the copy of packages/hyper-php that the board installs and reinstall it in the board (HY-79)
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	node scripts/publish.mjs composer-copy $(HYPER_PHP_COPY) $(BOARD)/vendor/polyspec/hyper

package-check: packages node-fixtures ## Install the npm packages into tests/package-install, type-check its test against their declarations and run it under node (HY-61)
	cd tests/package-install && node ../../scripts/kit/holder-lock.mjs run ../../$(INSTALL_LOCK) -- $(NPM) ci --offline --install-links --no-bin-links --allow-remote=root --no-audit --no-fund
	$(TSC) -p tests/package-install/tsconfig.json
	node scripts/kit/run-tests.mjs node --cwd tests/package-install -- package-install.test.ts

server: packages hyper-php-copy ## Build the board server program: its templates and the generated PHP program (HY-48)
	node $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

server-fixtures: packages ## Build the server program of the PHP test fixtures
	node $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --php-namespace 'Polyspec\Hyper\Tests\Program'

node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: packages ## Build the template files of the PHP test fixtures for the Node server tests
	node scripts/build-templates.mjs --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	node $(BUILD_PACKAGE)/bin/hyper-build-assets.mjs --app $(BOARD) --api /api --output $(BOARD)/build --static public/assets/app.css --static public/assets/reader.css

test-js: toolchain-check ## Run the browser code tests, including the router conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(JS_PACKAGE),node scripts/kit/run-tests.mjs vitest --cwd $(JS_PACKAGE)) \
	$(call check,the type check of $(JS_PACKAGE),$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json) \
	$(checks_result)

test-node: packages node-fixtures ## Run the Node server tests, including the PHP AppTest cases and the JSON conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(NODE_PACKAGE),node scripts/kit/run-tests.mjs vitest --cwd $(NODE_PACKAGE)) \
	$(call check,the type check of $(NODE_PACKAGE),$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json) \
	$(checks_result)

test-php: server-fixtures ext ## Run the server package tests with the generated program and with the native extension
	@failed=; \
	$(call check,PHPUnit with the generated program,COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node scripts/kit/run-tests.mjs phpunit --cwd $(PHP_PACKAGE)) \
	$(call check,PHPUnit with the native extension,COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node scripts/kit/run-tests.mjs phpunit --cwd $(PHP_PACKAGE) --php-extension $(EXT)) \
	$(checks_result)

test-python: ## Run the Python server package tests, which read the conformance cases of routes, rest, csrf, fields and json
	PYTHONPATH=$(CURDIR)/$(PYTHON_PACKAGE)/src $(PYTHON) $(PYTHON_PACKAGE)/tests/run.py; unit=$$?; $(PYTHON) $(PYTHON_PACKAGE)/tests/run.py $(PYTHON_PACKAGE)/tests/package 'test_*.py'; package=$$?; test $$unit -eq 0 -a $$package -eq 0

# The rendering tests need the template Python package (H15.3-3), which they read from the checkout $(TEMPLATE_REPOSITORY)
# of the template tag TEMPLATE_TAG (CI checks it out as ../template), and `make server-fixtures` writes the server program they open.
test-python-render: server-fixtures ## Run the Python rendering tests with the template package of the template checkout (H15.3-3)
	PYTHONPATH=$(CURDIR)/$(PYTHON_PACKAGE)/src:$(CURDIR)/$(TEMPLATE_REPOSITORY)/packages/template-python/src $(PYTHON) $(PYTHON_PACKAGE)/tests/run.py $(PYTHON_PACKAGE)/tests/render 'render_*.py'

lint: toolchain-check ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: ext ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	node scripts/check-templates.mjs --app $(BOARD)

test-scripts: packages ## Run the tests of the check scripts, or only the files of TESTS
	node scripts/kit/run-tests.mjs node -- $(or $(TESTS),tests/scripts/)

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	@failed=; \
	$(call check,parity with the generated program,node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json) \
	$(call check,parity with the native extension,node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --extension $(EXT)) \
	$(checks_result)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HY-55)
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node

# The Python server renders with the template Python package of the template checkout (H15.3-3), so this comparison
# runs where that checkout exists.
server-parity-python: assets server ## Compare the Python server responses with the PHP responses, with the browser comparison of parity (HY-55)
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --python

bundle-size: assets ## Print the sizes of the SSR script, the CSR shell and the largest template with their gzip limits; a size above its limit is a warning, never a failure
	node scripts/check-bundle-size.mjs --app $(BOARD) --output $(BOARD)/build --limits config/bundle-size.json

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run
	node scripts/run-e2e.mjs

virtiofs-check: toolchain-check ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HY-68); a target of the full suite on Darwin
	node scripts/kit/run-tests.mjs node -- tests/virtiofs/

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	node scripts/serve-demo.mjs --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	node scripts/kit/holder-lock.mjs clear $(SERVE_DEMO_LOCK)

bench-server: server ext ## Measure PHP request handling and rendering cost per row count, with the generated program and with the native extension
	@failed=; \
	$(call check,the benchmark with the generated program,php scripts/bench-server.php --app $(BOARD) --iterations 300) \
	$(call check,the benchmark with the native extension,php -d extension=$(abspath $(EXT)) scripts/bench-server.php --app $(BOARD) --iterations 300) \
	$(checks_result)

bench-browser: assets server ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	node scripts/bench-browser.mjs --runs 15

bench-server-smoke: assets server ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php scripts/bench-server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser ## Run both measurements; results are reports, not pass or fail checks

# The targets of the full suite. `make check` runs them through the guard scripts/kit/full-run.mjs, which refuses while a
# checklist task is [~], while tracked changes are uncommitted or when var/full-run.json records a run of the current tree
# and the commit of the template tag, runs each target with `make <target>` to its end and records its result;
# `make rerun-failed` reruns the targets of the current tree that did not pass.
CHECK_TARGETS := kit-check kit-test documents-check hooks-check push-gate-commit commits-check owner-validate dependency-policy-check dependency-policy-mutation-check bench-server-smoke lint analyse-php templates-check test-scripts test-js test-node test-python test-python-render package-check test-php parity server-parity server-parity-python bundle-size e2e

# The CI groups of the full suite (HY-91) are the entries of the matrix of .github/workflows/ci.yml: each entry runs its
# `targets` with `make ci-targets`, so the entries together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mjs). An entry gathers the targets that need the same setup: docs only Node.js, php and
# node PHP, the template build and the install, board also Chromium, python only the Python of its pins.

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mjs). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

# The full run is keyed by the tree and by the commit of the template tag, whose native extension sources the targets
# build (HY-80): a run of the same tree with another template commit is another run.
TEMPLATE_COMMIT = $(shell git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}')
FULL_RUN_KEYS = --key template=$(TEMPLATE_COMMIT)

check: template-tag ## Run every check through the guard: once per tree, when no checklist task is [~]
	node scripts/kit/full-run.mjs run $(FULL_RUN_KEYS) $(CHECK_TARGETS)

rerun-failed: template-tag

install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HY-91)
	$(ONLINE) node node_modules/@playwright/test/cli.js install --with-deps chromium

# The steps of .github/workflows/release.yml for the tag TAG (scripts/kit/release.mjs, config/release.json), in this order:
# release-verify requires the tagged commit on origin/main with the check ci-passed passed, release-versions the version of
# the tag in every manifest and its section in CHANGELOG.md, release-assets builds the packages and their archives into
# var/release/assets, and release-publish creates the GitHub Release. The targets are those of scripts/kit/kit.mk; the
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
