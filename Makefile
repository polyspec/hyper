# The Makefile of hyper holds every recipe of this repository; it includes no file of @polyspec/kit (kit 0.0.98 ships no recipe).
# The recipes run the utilities of the installed kit package, each with its arguments: a native local link to the kit
# checkout runs its sources (scripts/kit/*.mts, which the exports of its package.json name), the packed release its dist
# (dist/*.mjs). make reads the package again in every run, a recursive one too, so a run reads the kit that is installed.
KIT_PACKAGE := $(realpath node_modules/@polyspec/kit)
KIT_SOURCE := $(wildcard $(KIT_PACKAGE)/scripts/kit/run-tests.mts)
KIT := $(if $(KIT_SOURCE),$(KIT_PACKAGE)/scripts/kit,$(KIT_PACKAGE)/dist)
KIT_EXT := $(if $(KIT_SOURCE),mts,mjs)

# The tools of the checkout, which make install-tools installs into var/tools of this checkout, a linked worktree too. The
# shims of mise in var/tools/mise/shims read the folders of that mise and the mise.toml of the checkout from the
# environment, as the installer of kit names them; mise.toml states the settings of mise and uv ([settings], [env]).
KIT_TOOLS := $(CURDIR)/var/tools
export MISE_DATA_DIR := $(KIT_TOOLS)/mise
export MISE_CACHE_DIR := $(KIT_TOOLS)/mise/cache
export MISE_STATE_DIR := $(KIT_TOOLS)/mise/state
export MISE_CONFIG_DIR := $(KIT_TOOLS)/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
export MISE_GLOBAL_CONFIG_ROOT := $(CURDIR)
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_GLOBAL_CONFIG_ROOT
# The node of mise.toml, which the bootstrap wraps in var/tools/bin; the bootstrap itself runs on the Node.js of the machine.
NODE := $(KIT_TOOLS)/bin/node
BOOTSTRAP_NODE := node
ALINT := $(KIT_TOOLS)/mise/shims/alint

# The npm that devEngines of package.json names installs the lock, @polyspec/kit included, before the tools of the checkout
# exist. It runs outside the checkout with --prefix, since an npm of another version refuses a folder whose devEngines
# names npm 12.2.0 (EBADDEVENGINES, kit K938); npm reads allow-remote of the .npmrc of the checkout (kit K1045).
# A native local package link uses this same path; a sibling checkout is optional.
.PHONY: bootstrap
BOOTSTRAP_NPM := $(abspath $(shell command -v npm))
bootstrap: ## Bootstrap the lock with the declared native npm before installed tools exist
	root="$$PWD"; version="$$(node -p 'require("./package.json").devEngines.packageManager.version')"; \
	cd "$${TMPDIR:-/tmp}" && npm_config_offline=false npm_config_cache="$$root/var/bootstrap/npm-cache" "$(BOOTSTRAP_NPM)" exec --yes --package="npm@$$version" -- npm --prefix "$$root" ci --ignore-scripts

BOARD := examples/board
PHP_PACKAGE := packages/php
JS_PACKAGE := packages/client
NODE_PACKAGE := packages/ts
BUILD_PACKAGE := packages/cli
PYTHON_PACKAGE := packages/python
# The Python of the checks is the python of mise.toml, which `make install-tools` installs with mise at the digest of mise.lock
# and its shim runs (HR-81, kit K127). requires-python >= 3.14 states the tested minor of the package (H20.12).
# The absolute path, as NPM and COMPOSER_BIN have, because make looks up a recipe line on its own PATH.
# The virtual environment of the Python server package: make hyper-install makes it from the Python of mise.toml with kit's
# python-venv and installs the package into it non-editable with its dependencies, the template wheel of the release
# included, so the tests and the board Python server import the installed packages and read no source path (S5). The python
# extractor of kit reads the modules from the file list of the installed distribution, which an editable install does not
# hold (kit K788); the link of kit then makes the installed package folder a link to the checkout (kit K765). The venv is made
# anew, so uv writes no file through a link of the venv that it replaces.
PYTHON_VENV := $(CURDIR)/$(PYTHON_PACKAGE)/.venv
UV := $(KIT_TOOLS)/mise/shims/uv
# The Python of that venv, which scripts/board-servers.mts starts the board Python server with.
export HYPER_PYTHON := $(PYTHON_VENV)/bin/python
# TEMPLATE_VERSION is the one declaration of the template release that hyper uses; every pin of the manifests and their locks
# names it (H21.4). npm installs @polyspec/template and @polyspec/template-compiler from the tarballs of that release that
# package.json names (HR-70). Composer installs polyspec/template from TEMPLATE_PACKAGES, the Composer repository of the
# release (packages.json), which composer.json and examples/board/composer.json declare and whose dist carries the sha1 of the
# php zip; PIE builds the native template extension polyspec/template-php-ext from the same repository (H27.45).
TEMPLATE_VERSION := 0.0.27
TEMPLATE_TAG := v$(TEMPLATE_VERSION)
TEMPLATE_PACKAGES := https://github.com/polyspec/template/releases/download/$(TEMPLATE_TAG)/packages.json
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The Composer vendor directory of the private root composer.json, which installs packages/php for development.
PHP_VENDOR := $(CURDIR)/vendor
# The native template extension, built from the unpacked php-ext asset (HY-48, H14.1-7).
# The lock of `make serve-demo`, whose fixed ports exist once on this machine (holder-lock of @polyspec/kit).
SERVE_DEMO_LOCK := /tmp/hyper-serve-demo.lock
# The TypeScript compiler of the bin link that npm writes (HR-79), by its absolute path, as NPM and COMPOSER_BIN.
TSC := $(CURDIR)/node_modules/.bin/tsc
# The esbuild package replaces bin/esbuild with the executable of the platform when it installs.
ESBUILD := node_modules/esbuild/bin/esbuild
# The path repository packages/php, which the board links with Composer (HR-79).
# The PHP memory limit of PHPStan: a run without its result cache (build/phpstan) needs 132 MB in its worker, above
# the default limit of 128M.
PHPSTAN_MEMORY := 256M
# The library of the native template extension that `make hyper-install` builds with PIE (H14.1-7, H27.45, H27.51).
EXT := build/ext/polyspec_template.so

# The toolchain (HR-81, install-tools of @polyspec/kit): npm and Composer of the checkout ($(KIT_TOOLS), its own var/tools in a
# linked worktree too, kit K858), which `make install-tools` installs into its var/tools, come first on PATH for every recipe
# and the programs that it starts.
# kit 0.0.98's run-tests dropped NODE_TEST_CONTEXT, so a node --test that a recipe starts from inside a node test runs as
# its own run, not as a child of that test (kit K1094); no recipe passes it on.
unexport NODE_TEST_CONTEXT
export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise/shims:$(PATH)
# A check reads no network (HR-89): `make hyper-install` downloads everything that the checks read, and every other recipe
# and the programs that it starts run npm and Composer offline, so a missing download fails at once instead of
# reaching a registry in one run and not in another. The downloads of `make install-tools`, `make hyper-install` and
# `make hyper-install-browser` lift the settings with $(ONLINE).
export npm_config_offline := true
export COMPOSER_DISABLE_NETWORK := 1
ONLINE := env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK
# make 3.81 looks up the program of a recipe line without shell syntax on its own PATH, not on the exported one, so the
# recipes start npm by the absolute path of $(KIT_TOOLS)/bin and Composer, a tool of mise.toml, by that of its shim.
NPM := $(KIT_TOOLS)/bin/npm
export COMPOSER_BIN := $(KIT_TOOLS)/mise/shims/composer
# The lock of the package manager installs of this checkout: one npm or Composer install at a time (HR-82).
INSTALL_LOCK := var/install.lock

# A recipe with several checks runs every check to its end (HR-86): `$(call check,<name>,<command>)` prints the command,
# runs it through scripts/line-end.mts, which ends its output with a newline so the next line starts at column 0
# (HR-84), and records the name when it fails, and `$(checks_result)` then fails and names every failed
# check. A recipe that uses them starts with `@failed=; \` and joins its checks with `\`.
check = echo '$(2)'; $(NODE) scripts/line-end.mts '$(2)' || failed="$$failed $(1);";
checks_result = test -z "$$failed" || { echo "failed checks:$$failed"; exit 1; }

.DEFAULT_GOAL := help

.PHONY: bench-sessions bench-uploads help hyper-install hyper-install-python hyper-install-browser hyper-install-virtiofs hyper-test-node hyper-test-python-render hyper-test-scripts check typecheck hyper-php-install ext packages package-check server server-fixtures contract-programs node-server node-fixtures assets hyper-test-js hyper-test-php hyper-test-python hyper-lint analyse-php templates-check virtiofs-check parity server-parity server-parity-python bundle-size e2e serve-demo bench-server bench-server-smoke bench-browser bench serve-demo-unlock

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

# The install order of a checkout: the mise, node and npm of mise.toml (the bootstrap of install-tools), the packages of
# package-lock.json with that npm, then the other tools of mise.toml, the symbol extractor of PHP, whose php-parser
# lint-php reads, and the Composer projects and the venv of hyper.
hyper-install: ## Install the pinned tools and the npm packages, fetch the archives of the template release and install the Composer dependencies and the Python venv (HR-89, H14.1-7); ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory install-symbols EXTRACTORS=php
	$(MAKE) --no-print-directory hyper-install-php
	$(MAKE) --no-print-directory hyper-install-python

.PHONY: hyper-install-php
hyper-install-php: ## Install only the locked root and board Composer projects and their pinned PHP archives
	$(MAKE) --no-print-directory template-ext
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction --working-dir=$(BOARD)

hyper-install-python: ## Make the venv of the Python server package anew and install the package into it non-editable with its dependencies (S5)
	rm -rf $(PYTHON_VENV)
	$(NODE) $(KIT)/python-venv.$(KIT_EXT) $(PYTHON_VENV)
	UV_SYNC='--locked --quiet --no-editable --project $(PYTHON_PACKAGE)' $(ONLINE) $(NODE) $(KIT)/uv-install.$(KIT_EXT) .

hyper-install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HR-91)
	$(ONLINE) $(NODE) node_modules/@playwright/test/cli.js install --with-deps chromium

hyper-install-virtiofs: ## Install the digest-pinned image for Darwin virtiofs verification
	$(ONLINE) container image pull --platform linux/arm64 $(VIRTIOFS_IMAGE)

# make install of a checkout, which the worktree setup of kit runs too: hyper-install, then the links of .links (K869).
install: hyper-install ## Install everything that the checks read, then link the packages of .links; ONLINE
	$(MAKE) --no-print-directory install-link

test: hyper-test-js hyper-test-node hyper-test-php hyper-test-python hyper-test-python-render hyper-test-scripts ## Run the tests of every package and of the scripts

lint: hyper-lint lint-ts lint-php lint-python ## Run the lint of every language of the checkout

# The release workflow runs make release-prepare before release-tools: the release installs as CI does, each template asset
# verified by the integrity of its lock (HR-80, H23.7).
release-prepare: ## Install the locked dependencies, for a release; ONLINE
	$(ONLINE) $(MAKE) hyper-install

# PIE resolves polyspec/template-php-ext TEMPLATE_VERSION in the Composer repository TEMPLATE_PACKAGES, which checks the sha1
# of its zip, and builds it with phpize and the php-config of the PHP of PATH (H27.51). PIE keeps one Composer project per
# target PHP in PIE_WORKING_DIRECTORY and never undoes repository:add, so each run starts in an empty PIE_WORK.
# scripts/pie-binary.mts prints the one library that PIE recorded there, which is published into build/ext with a rename
# (scripts/publish.mts, HR-82). `pie build` installs nothing into the PHP; the checks load the library with -d extension.
# PIE is the http:pie of mise.toml, which `make install-tools TOOLS=pie` installs.
PIE := $(KIT_TOOLS)/mise/shims/pie
PIE_WORK := $(CURDIR)/var/pie/polyspec/template-php-ext
.PHONY: template-ext
template-ext: ## Build the native template extension of TEMPLATE_TAG with PIE from the Composer repository of the template release into build/ext (H27.45, H27.51); ONLINE
	rm -rf $(PIE_WORK) && mkdir -p $(PIE_WORK)
	$(ONLINE) env PIE_WORKING_DIRECTORY=$(PIE_WORK) $(PIE) repository:add composer $(TEMPLATE_PACKAGES) --no-interaction
	$(ONLINE) env PIE_WORKING_DIRECTORY=$(PIE_WORK) $(PIE) build polyspec/template-php-ext:$(TEMPLATE_VERSION) --no-interaction
	@binary=$$($(NODE) scripts/pie-binary.mts $(PIE_WORK) polyspec/template-php-ext) || exit $$?; \
	  mkdir -p build/ext.next-$$$$ && trap 'rm -rf build/ext.next-$$$$' EXIT && trap 'exit 130' INT TERM && cp "$$binary" build/ext.next-$$$$/polyspec_template.so && $(NODE) scripts/publish.mts directory build/ext.next-$$$$ build/ext

# The session tests of HY-115 run against a real Redis server and the real phpredis extension, at these versions. PIE builds
# phpredis as it builds the template extension; `pie build` installs nothing into the PHP, and the tests load the library
# with -d extension.
REDIS_VERSION := 8.10.3
REDIS_SHA256 := 5e0c00ed77f789fb1a4a30f1fbb58a793cc88c41c0f11f0e38e1b4f192991188
PHPREDIS_VERSION := 6.3.0
REDIS_DIR := $(CURDIR)/var/redis
PHPREDIS_WORK := $(CURDIR)/var/pie/phpredis
.PHONY: hyper-install-redis
hyper-install-redis: ## Build the Redis server and the phpredis extension of the session tests into var/redis (HY-115); ONLINE
	mkdir -p $(REDIS_DIR)
	$(ONLINE) $(NODE) scripts/install-redis.mts $(REDIS_VERSION) $(REDIS_SHA256) $(REDIS_DIR)
	rm -rf $(PHPREDIS_WORK) && mkdir -p $(PHPREDIS_WORK)
	$(ONLINE) env PIE_WORKING_DIRECTORY=$(PHPREDIS_WORK) $(PIE) build phpredis/phpredis:$(PHPREDIS_VERSION) --no-interaction
	@binary=$$($(NODE) scripts/pie-binary.mts $(PHPREDIS_WORK) phpredis/phpredis) || exit $$?; cp "$$binary" $(REDIS_DIR)/redis.so

# The checks load the library that `make hyper-install` built with PIE (template-ext); they run offline and build nothing.
ext: ## Fail unless the native template extension of make template-ext is in build/ext (HY-48, H14.1-7, H27.45)
	@test -f $(EXT) || { echo "ext: $(EXT) does not exist; run make hyper-install, which builds it with PIE (make template-ext)" >&2; exit 1; }

# A build that fails or is interrupted leaves no staging directory: the shell of each line removes its own when it ends
# (HR-87).
packages: ## Build the JavaScript modules and type declarations of the npm packages into their dist directories; npm links the workspaces (HR-61, HR-79, HR-96)
	cd $(JS_PACKAGE) && trap 'rm -rf dist.next-$$$$' EXIT && trap 'exit 130' INT TERM && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist
	cd $(NODE_PACKAGE) && trap 'rm -rf dist.next-$$$$' EXIT && trap 'exit 130' INT TERM && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist

# The path repository of the board links the PHP server package to packages/php (Composer's default, HR-79), so the
# board runs the current source without a copy. The install reads no registry: the targets of the checks reach it, so Composer
# installs offline from the cache that make hyper-install filled (HR-89), and make install-link PROJECT=$(BOARD) then links into the
# board alone the polyspec packages that a checkout of .links provides (K448, kit K983); it writes no Claude Code hook, which make
# link of development writes (kit K967).
hyper-php-install: ## Install the Composer dependencies of the board offline, which link polyspec/hyper to packages/php (HR-79), and link the polyspec packages of .links
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction --working-dir=$(BOARD)
	$(MAKE) --no-print-directory install-link PROJECT=$(BOARD)

# package-check is a check, so it installs offline from the npm cache that make hyper-install filled and fails by the name of a
# package that the cache lacks (HR-89); npm alone owns the links and installed records of this declared consumer graph.
package-check: packages node-fixtures ## Install the npm packages into tests/package-install offline, link them, type-check its test against their declarations and run it under node (HR-61)
	cd tests/package-install && $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(abspath $(INSTALL_LOCK)) -- $(NPM) ci --no-audit
	$(MAKE) --no-print-directory install-link PROJECT=tests/package-install
	$(TSC) -p tests/package-install/tsconfig.json
	NPM_BIN=$(NPM) $(NODE) $(KIT)/run-tests.$(KIT_EXT) node --cwd tests/package-install -- --test-concurrency=1 package-install.test.ts

server: packages assets ## Build the board server program from installed dependencies: its templates and generated PHP program (HY-48, HY-125)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --php-namespace 'Polyspec\Hyper\Examples\Board\Program' --build $(abspath $(BOARD)/build/build.json)

server-fixtures: packages contract-programs ## Build the server program of the PHP test fixtures with the fixed build id of their build.json (HY-48, HY-125.21)
	$(NODE) scripts/fixture-program.mts --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --php-namespace 'Polyspec\Hyper\Tests\Program' --id-file $(FIXTURES)/build.json

contract-programs: packages ## Build the applications of contracts/context.json, contracts/functions.json, contracts/representations.json and contracts/app.json and one application per case of contracts/reads.json for the tests of the three servers (HY-73, HY-118, HY-124, HYC-24)
	$(NODE) scripts/contract-programs.mts --contract $(abspath contracts/context.json) --contract $(abspath contracts/functions.json) --contract $(abspath contracts/representations.json) --contract $(abspath contracts/app.json) --reads $(abspath contracts/reads.json) --output $(abspath var/contract-programs)

# A Node server bundle keeps the packages of node_modules external, and Node loads them from there: a CommonJS package that
# requires Node modules cannot run inside an ESM bundle.
node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --packages=external --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: packages contract-programs ## Build the template files of the PHP test fixtures for the Node server tests
	$(NODE) scripts/build-templates.mts --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build

# Shared gates read the declarations and runtime fixtures built by this checkout.
lint-ts: packages

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-assets.mjs --app $(BOARD) --api /api --output $(BOARD)/build --static public/assets/app.css --static public/assets/reader.css --static public/assets/reader.js --static public/assets/after-reader.js

hyper-test-js: ## Run the browser code tests, including the browser case runner (HYR-7), and the type check
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,the tests of $(JS_PACKAGE),RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/browser.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(JS_PACKAGE)$(if $(JS_TESTS), -- $(JS_TESTS))) \
	$(call check,the type check of $(JS_PACKAGE),$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json) \
	$(checks_result)

hyper-test-node: packages node-fixtures ## Run the Node server tests, including the case runner (HYR-7), and the type check
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,the tests of $(NODE_PACKAGE),RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/node.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE)) \
	$(call check,the type check of $(NODE_PACKAGE),$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json) \
	$(checks_result)

hyper-test-php: server-fixtures ext ## Run the server package tests, the case runner included (HYR-7), with the generated program and with the native extension
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,PHPUnit with the generated program,RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/php.txt COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE)) \
	$(call check,PHPUnit with the native extension,RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/php-extension.txt COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) --php-extension $(EXT)) \
	$(checks_result)

hyper-test-python: server-fixtures ## Run the Python server package tests, the case runner included (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,Python protocol unit tests,RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/python.txt PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p 'test_*.py') \
	$(call check,Python package data tests,PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s tests/python_package -p 'test_*.py') \
	$(checks_result)

# The rendering tests need the template Python package (H15.3-3), the wheel of the template release that the venv of make
# install holds, and `make server-fixtures` writes the server program they open.
hyper-test-python-render: server-fixtures ## Run the Python rendering tests with the template package of the venv (H15.3-3)
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests/render -t $(PYTHON_PACKAGE) -p 'render_*.py'

hyper-lint: ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: ext ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/phpstan analyse --configuration=phpstan-max.neon --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: ## Check the manifest (HY-2), the hx- attributes (HC-6) and the region placements (HY-3, HY-30) of the board with hyper check (HY-48.3)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper.mjs check --app $(BOARD)

# The TypeScript of scripts/, tests/ and benchmarks/ (tsconfig.json), which Node runs by type stripping and so never checks
# itself (S9 of kit). scripts/check-parity.mts imports the types of @polyspec/hyper-client, which the package's build writes
# to its dist, so packages runs first.
typecheck: packages ## Check the types of the TypeScript of scripts/, tests/ and benchmarks/ with the tsc of node_modules (tsconfig.json)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'typecheck needs the pinned TypeScript of scripts/recipe/typescript, whose declarations scripts/recipe/read-node.mts imports: run make install-packages'; exit 1; }
	$(TSC) -p tsconfig.json

.PHONY: toolchain-policy-test
toolchain-policy-test: ## Verify the declared toolchain and offline recipe policy
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/scripts/toolchain.test.mts

# The tests are the files of tests/scripts itself: a file below tests/scripts/fixtures that is named as a test is the
# input of a test and is not run.
hyper-test-scripts: packages assets server node-server ## Run the tests of the check scripts, the build case runner included (HYR-7), or only the files of TESTS
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/build.txt $(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 $(or $(TESTS),$(wildcard tests/scripts/*.test.mts))

# The recipe check (HYR-8) and the candidate of its spec (HYR-10). The TypeScript reader needs the pinned TypeScript of
# scripts/recipe/typescript, which `make install-packages` installs from its lock; `typecheck` and `lint-ts` read its declarations. The case results (HYR-7) are the
# files that each language's case runner writes under RECIPE_RESULTS_DIR; a missing file fails the check.
RECIPE_TYPESCRIPT := scripts/recipe/typescript/node_modules
RECIPE_RESULTS_DIR := $(CURDIR)/var/recipe/results

.PHONY: recipe-check recipe-candidates recipe-run-php recipe-run-node recipe-run-python recipe-run-browser recipe-run-build
# Each case runner writes one line per case to the file that RECIPE_RESULTS names (HYR-7); recipe-check runs the five
# runners to their end, then the check, which reads their files, and fails when a runner or the check fails.
recipe-run-php: server-fixtures ## Run the PHP case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/php.txt COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) -- --filter CaseRunnerTest

recipe-run-node: packages node-fixtures ## Run the Node case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/node.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE) -- tests/case-runner.test.ts

recipe-run-python: server-fixtures ## Run the Python case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/python.txt PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p test_case_runner.py

recipe-run-browser: packages ## Run the browser case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/browser.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(JS_PACKAGE) -- tests/case-runner.test.ts

recipe-run-build: packages ## Run the build case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/build.txt $(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/scripts/build-id.test.mts

recipe-check: ## Check contracts/interfaces.json against the sources of the three servers and their case results (HYR-7, HYR-8)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'recipe-check needs the pinned TypeScript of scripts/recipe/typescript: run make install-packages'; exit 1; }
	@failed=; \
	$(call check,the PHP case runner,$(MAKE) --no-print-directory recipe-run-php) \
	$(call check,the Node case runner,$(MAKE) --no-print-directory recipe-run-node) \
	$(call check,the Python case runner,$(MAKE) --no-print-directory recipe-run-python) \
	$(call check,the browser case runner,$(MAKE) --no-print-directory recipe-run-browser) \
	$(call check,the build case runner,$(MAKE) --no-print-directory recipe-run-build) \
	$(call check,the recipe check,$(NODE) scripts/recipe/check.mts --root . --php-autoload $(PHP_VENDOR)/autoload.php --results php=$(RECIPE_RESULTS_DIR)/php.txt --results node=$(RECIPE_RESULTS_DIR)/node.txt --results python=$(RECIPE_RESULTS_DIR)/python.txt --results browser=$(RECIPE_RESULTS_DIR)/browser.txt --results build=$(RECIPE_RESULTS_DIR)/build.txt) \
	$(checks_result)

recipe-candidates: ## Write the candidate of contracts/interfaces.json under var/recipe, with the hand-written fields listed beside it (HYR-10)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'recipe-candidates needs the pinned TypeScript of scripts/recipe/typescript: run make install-packages'; exit 1; }
	$(NODE) scripts/recipe/candidate.mts --root . --php-autoload $(PHP_VENDOR)/autoload.php --output var/recipe/interfaces.candidate.json

.PHONY: core-test core-lint core-fmt-check
# The Rust core of the server rules (C-7) at packages/rust, built with the toolchain of its rust-toolchain.toml
# and the lints of its Cargo.toml and clippy.toml (plan R-1).
CORE := packages/rust
core-test: ## Run the tests of the Rust core, which run the cases of contracts/ that it decides (HY-132)
	cd $(CORE) && cargo test --locked
core-lint: ## Run clippy on the Rust core and its tests with every warning an error (plan R-1)
	cd $(CORE) && cargo clippy --locked --all-targets -- -D warnings
core-fmt-check: ## Check the format of the Rust core
	cd $(CORE) && cargo fmt --check

# The bindings of the Rust core for the five targets of packages/rust/interface.json (binding design L-1, L-2, L-2a).
# BINDING is the cli of a binding checkout (packages/ts/src/cli.ts), which bindings and bindings-check run; both fail
# without it. bindings writes the generated folders, which Git ignores (native/generated/ of packages/php,
# packages/python and packages/ts, packages/ts/native/wasm/generated, packages/go/internal/ffi/generated), and the
# tracked Go files zz_generated_*.go of packages/go (binding GN-3). bindings-check runs the contract check, which also
# compares the tracked binding packages with what binding scaffold writes (binding L-2, CK-19).
.PHONY: bindings bindings-check lint-bindings test-bindings node-package test-wasm test-go
BINDING ?=
bindings: ## Write the generated sources of every binding with the binding cli of BINDING (binding L-1)
	@test -n "$(BINDING)" || { echo "bindings: set BINDING to the cli of binding"; exit 1; }
	$(NODE) $(BINDING) generate --root $(CURDIR)
bindings-check: ## Check the interface contract and the tracked binding packages with the binding cli of BINDING (binding CK-19)
	@test -n "$(BINDING)" || { echo "bindings-check: set BINDING to the cli of binding"; exit 1; }
	$(NODE) $(BINDING) check $(CURDIR)/packages/rust/interface.json

# The binding crates of the workspace. The WASM crate is not in the tree (Cargo.toml): its lint and its build name the
# manifest of the place that binding scaffold gives it, and fail while it is missing.
BINDING_CRATES := polyspec-hyper-php-ext polyspec-hyper-python polyspec-hyper-node polyspec-hyper-go
WASM_MANIFEST := packages/ts/native/wasm/Cargo.toml
lint-bindings: bindings ## Run clippy on the binding crates with every warning an error, after make bindings
	cargo clippy --locked $(foreach crate,$(BINDING_CRATES),-p $(crate)) --all-targets --features panic-test -- -D warnings
	cargo clippy --locked --manifest-path $(WASM_MANIFEST) --target wasm32-unknown-unknown --features panic-test -- -D warnings
test-bindings: lint-bindings test-wasm test-go ## Run the tests of the binding crates and the generated tests of WASM and Go
	cargo test --locked $(foreach crate,$(BINDING_CRATES),-p $(crate))

# The Go of the go directive of packages/go/go.mod and the wasm-bindgen CLI of the release of the wasm-bindgen crate of
# the WASM crate (binding GN-15, GN-18), which mise.toml pins and make install-tools installs into var/tools (HR-81);
# test-go and node-package compare both releases before they use them.
GO ?= $(KIT_TOOLS)/mise/shims/go
GOFMT ?= $(KIT_TOOLS)/mise/shims/gofmt
WASM_BINDGEN ?= $(KIT_TOOLS)/mise/shims/wasm-bindgen
# The file name extension of a library that Cargo builds as a cdylib: dylib on macOS, so on Linux.
CDYLIB := $(if $(filter Darwin,$(shell uname -s)),dylib,so)
CARGO_TARGET := $(CURDIR)/target
BINDINGS_VAR := $(CURDIR)/var/bindings
WASM_BINDGEN_RELEASE := $(if $(wildcard $(WASM_MANIFEST)),$(shell sed -n 's/^wasm-bindgen = "=\(.*\)"$$/\1/p' $(WASM_MANIFEST)))
NODE_PLATFORM := $(shell uname -s | tr A-Z a-z)-$(subst x86_64,x64,$(subst aarch64,arm64,$(shell uname -m)))$(if $(filter Linux,$(shell uname -s)),-gnu)
NODE_ADDON := hyper.$(NODE_PLATFORM).node
NODE_VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' $(NODE_PACKAGE)/package.json)

# The npm package and the package of the addon of this platform, packed and installed into var/bindings/node. The
# package holds the WASM module and its glue, which wasm-bindgen writes into packages/ts/native/wasm/generated before
# the package is packed (binding GN-18, P-5); the addon is the package of this platform that the package names in
# optionalDependencies (binding T-2), installed from its tarball without the packages of the other platforms.
node-package: bindings packages ## Build the WASM module and the Node addon, then pack and install the npm package into var/bindings/node
	test "$$($(WASM_BINDGEN) --version)" = "wasm-bindgen $(WASM_BINDGEN_RELEASE)"
	cargo build --locked --manifest-path $(WASM_MANIFEST) --target wasm32-unknown-unknown --features panic-test
	$(WASM_BINDGEN) --target web --out-dir $(NODE_PACKAGE)/native/wasm/generated --out-name hyper_wasm \
		$(CARGO_TARGET)/wasm32-unknown-unknown/debug/polyspec_hyper_wasm.wasm
	cargo build --locked -p polyspec-hyper-node --features panic-test
	mkdir -p $(BINDINGS_VAR)/node $(BINDINGS_VAR)/node-platform
	cp $(CARGO_TARGET)/debug/libpolyspec_hyper_node.$(CDYLIB) $(BINDINGS_VAR)/node-platform/$(NODE_ADDON)
	$(NODE) -e 'require("fs").writeFileSync("$(BINDINGS_VAR)/node-platform/package.json", JSON.stringify({ name: "@polyspec/hyper-$(NODE_PLATFORM)", version: "$(NODE_VERSION)", os: [process.platform], cpu: [process.arch], main: "$(NODE_ADDON)", files: ["$(NODE_ADDON)"] }, null, 2) + "\n")'
	cd $(BINDINGS_VAR)/node-platform && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	cd $(NODE_PACKAGE) && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	echo '{ "private": true }' > $(BINDINGS_VAR)/node/package.json
	cd $(BINDINGS_VAR)/node && $(NPM) install --no-audit --no-fund --omit=optional ./polyspec-hyper-$(NODE_VERSION).tgz ./polyspec-hyper-$(NODE_PLATFORM)-$(NODE_VERSION).tgz

# The generated tests of the WASM binding through the subpath ./wasm of the installed package (binding P-5);
# --expose-gc serves the generated tests that collect instances (binding GN-18a).
test-wasm: node-package ## Run the generated tests of the WASM binding on node --test against the installed package
	cp $(NODE_PACKAGE)/native/wasm/generated/tests/generated.test.mjs $(BINDINGS_VAR)/node/generated.wasm.test.mjs
	cd $(BINDINGS_VAR)/node && $(NODE) --expose-gc --test generated.wasm.test.mjs

# The static library with the test features (binding GN-13b), which Go links through CGO_LDFLAGS; gofmt and go vet,
# then the generated tests on go test. GOTOOLCHAIN=local: a go of another release than the go directive fails instead
# of fetching that release.
GO_RELEASE := $(shell sed -n 's/^go \(.*\)$$/\1/p' packages/go/go.mod)
GO_ENV := GOTOOLCHAIN=local CGO_LDFLAGS=-L$(CARGO_TARGET)/debug GOFLAGS=-tags=polyspec_panic_test,polyspec_codec_test
test-go: bindings ## Build the static library of the Go binding, run gofmt and go vet, then the generated tests on go test
	test "$$($(GO_ENV) $(GO) env GOVERSION)" = "go$(GO_RELEASE)"
	cargo build --locked -p polyspec-hyper-go --features panic-test,codec-test
	test -z "$$(cd packages/go && $(GOFMT) -l .)"
	cd packages/go && $(GO_ENV) $(GO) vet ./...
	cd packages/go && $(GO_ENV) $(GO) test -count=1 -v ./...

.PHONY: spec-docs spec-docs-check
spec-docs: ## Write docs/spec/protocol.md and protocol.ko.md from contracts/protocol.json (H2)
	$(NODE) scripts/spec-docs.mts write
spec-docs-check: ## Check contracts/protocol.json and the protocol documents against their generation (H2)
	$(NODE) scripts/spec-docs.mts check

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	@failed=; \
	$(call check,parity with the generated program,node scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json) \
	$(call check,parity with the native extension,node scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --extension $(EXT)) \
	$(checks_result)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node

server-parity-python: assets server ## Compare the Python server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --python

bundle-size: assets ## Print the sizes of the SSR script, the CSR shell, the chunks and the largest template with their gzip limits; a size above its limit is a warning, never a failure
	$(NODE) scripts/check-bundle-size.mts --app $(BOARD) --output $(BOARD)/build --limits config/bundle-size.json$(if $(filter true,$(GITHUB_ACTIONS)), --annotations)

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run; CASES=<pattern> runs the cases whose title matches
	$(NODE) scripts/run-e2e.mts -- $(NODE) $(KIT)/run-tests.$(KIT_EXT) playwright -- --config tests/e2e/playwright.config.ts$(if $(CASES), --grep '$(CASES)')

virtiofs-check: ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HR-68); a target of the full suite on Darwin
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/virtiofs/

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	$(NODE) scripts/serve-demo.mts --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) clear $(SERVE_DEMO_LOCK)

bench-server: assets server ext ## Measure PHP request handling and rendering cost per row count, with the generated program and with the native extension
	@failed=; \
	$(call check,the benchmark with the generated program,php benchmarks/server.php --app $(BOARD) --iterations 300) \
	$(call check,the benchmark with the native extension,php -d extension=$(abspath $(EXT)) benchmarks/server.php --app $(BOARD) --iterations 300) \
	$(checks_result)

bench-browser: assets server ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	$(NODE) benchmarks/browser.mts --runs 15

bench-sessions: packages ## Measure the requests per second of the three servers on one Redis server
	$(NODE) benchmarks/sessions.mts --requests 20000

bench-uploads: packages ## Measure the time, the processor time and the memory of an upload in the three servers and in the reader of PHP itself
	$(NODE) benchmarks/uploads.mts --size 1073741824 --runs 3

bench-server-smoke: assets server ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php benchmarks/server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser bench-uploads ## Run the measurements; results are reports, not pass or fail checks

# The final suite runs through the native kit report runner, which runs every target to its end and refuses nothing.
# Run it once after checklist development on a committed tree, then rerun only failed owners. GATE_TARGETS are the checks of the configuration,
# the layout, the documents, the owners, the parity declarations and the lint, which run the checkers of kit.
GATE_TARGETS := layout-check docs-check owner-validate rebuild-check rules-check language-check duplication-check suppression-check lint-ts lint-php lint-python
CHECK_TARGETS := $(GATE_TARGETS) typecheck bench-server-smoke hyper-lint analyse-php templates-check hyper-test-scripts spec-docs-check recipe-check hyper-test-js hyper-test-node hyper-test-python hyper-test-python-render package-check hyper-test-php parity server-parity server-parity-python bundle-size e2e

# The CI groups of the full suite (HR-91) are the entries of the matrix of .github/workflows/ci.yml: each entry runs its
# `targets` with `make ci-targets`, so the entries together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mts). An entry gathers the targets that need the same setup: docs Node.js, PHP and Python for the case runners of
# recipe-check, php and node PHP, the template build and the install, board also Chromium, python only the Python of its pins.

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mts). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
VIRTIOFS_IMAGE := docker.io/library/node:26.8.1-trixie-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

check: ## Run final verification once after checklist development, on a committed tree
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) -k var/report/full-run $(CHECK_TARGETS)



.PHONY: hyper-runner-owner-check
hyper-runner-owner-check: ## Verify application test entry points through the shared test runner
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/scripts/check-recipes.test.mts tests/scripts/ci-workflow.test.mts tests/scripts/run-e2e.test.mts

# ---- Tools and packages ----------------------------------------------------------------------------------------------
# TOOLS=npm is the first step of a checkout, before the pinned npm installs the packages: it runs the bootstrap of kit, which
# imports only Node.js built-ins, on the Node.js of the machine, and installs mise and the node and npm of mise.toml. Without
# TOOLS, install-tools installs every tool of mise.toml at the digests of mise.lock and the Composer projects of the lint of
# PHP; TOOLS="<name>..." installs only those tools.
.PHONY: install-tools install-packages install-symbols install-link toolchain-lock
# The home and the cache of the Composer that install-tools and install-symbols run, the folders of var/tools that kit 0.0.98
# set (kit K1095).
COMPOSER_TOOL_ENV = COMPOSER_HOME=$(CURDIR)/var/tools/composer/home COMPOSER_CACHE_DIR=$(CURDIR)/var/tools/composer/cache
install-tools: ## Install all locked tools or the tools of TOOLS; TOOLS=npm runs the bootstrap; ONLINE
ifeq ($(TOOLS),npm)
	$(ONLINE) $(BOOTSTRAP_NODE) $(KIT)/bootstrap/bootstrap.$(KIT_EXT)
else
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-tools.$(KIT_EXT) --no-self-update $(TOOLS)
endif

install-packages: ## Install the packages of package-lock.json, @polyspec/kit included, and the pinned TypeScript of the recipe reader (scripts/recipe/typescript), with the npm of var/tools; ONLINE
	$(ONLINE) $(NPM) ci
	$(ONLINE) $(NPM) ci --prefix scripts/recipe/typescript --ignore-scripts --no-audit

install-symbols: ## Install the symbol extractors of EXTRACTORS, such as php, whose php-parser lint-php reads; ONLINE
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-symbols.$(KIT_EXT) $(EXTRACTORS)

# install-link links the polyspec packages to the checkouts that the git-ignored .links names (K869); PROJECT selects one
# consumer folder. It writes no Claude Code setting.
install-link: ## Link the packages of .links after every install; PROJECT selects the consumer
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))

# mise lock locks uv and python first, then every tool with that Python as UV_PYTHON, for each platform that has its archive.
TOOLCHAIN_LOCK_PLATFORMS := linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64
toolchain-lock: ## Write mise.lock with mise lock for linux, macOS and Windows on x64 and arm64; ONLINE
	$(ONLINE) $(KIT_TOOLS)/bin/mise lock uv python --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)
	$(ONLINE) $(KIT_TOOLS)/bin/mise install --locked uv python
	UV_PYTHON="$$($(KIT_TOOLS)/bin/mise which python3)" $(ONLINE) $(KIT_TOOLS)/bin/mise lock --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)

# ---- Development links and row worktrees (docs/operations/development.md) ---------------------------------------------
.PHONY: link link-check unlink worktree-setup land hooks hooks-check twin-merge
link: ## Link the polyspec packages to the checkouts of .links; PROJECT selects the consumer; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))

link-check: ## Fail while the links differ from .links; offline
	$(NODE) $(KIT)/link-check.$(KIT_EXT)$(if $(PROJECT), --project $(PROJECT))

unlink: ## Remove the links of .links; make install restores the locked installs; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) unlink$(if $(PROJECT), --project $(PROJECT))

# The worktree of a row (kit K1107), as kit 0.0.98 made it: ../<main checkout>-<NAME>-<ID> on <TYPE or fix>/<NAME>-<ID> from main;
# a worktree without node_modules first gets npm ci of the npm of var/tools, then make install and make link-check run in it. The
# worktree runs its own tools in a make of its own (kit K858): the recipe drops the flags of this make and this var/tools from PATH.
WORKTREE_MAIN = $(patsubst %/.git,%,$(shell git rev-parse --path-format=absolute --git-common-dir))
WORKTREE_DECLARATION = --folder $(WORKTREE_MAIN)-$(NAME)-$(ID) --branch $(or $(TYPE),fix)/$(NAME)-$(ID) --base main --prepare 'test -d node_modules || PATH="$(KIT_TOOLS)/bin:$$PATH" $(NPM) ci --ignore-scripts' --make install --make link-check
WORKTREE_ENVIRONMENT = env -u MAKEFLAGS -u MFLAGS -u MAKELEVEL PATH="$$(printf '%s' "$$PATH" | awk -v RS=: -v ORS=: -v tools='$(KIT_TOOLS)' 'index($$0, tools) != 1' | sed 's/:$$//')"
worktree-setup: ## Create or reuse the worktree of the row ID named NAME from main and run make install in it; ONLINE
	$(ONLINE) $(WORKTREE_ENVIRONMENT) $(NODE) $(KIT)/worktree-setup.$(KIT_EXT) $(WORKTREE_DECLARATION)

land: ## Land the branch BRANCH on main fast-forward and remove its worktree; offline
	$(NODE) $(KIT)/land.$(KIT_EXT) $(BRANCH) main

# The declaration of make hooks (kit K1099): no hook,
# the merges of the changelogs and checklists (kit K354) and their drivers, which run twin-merge of this checkout.
TWIN_MERGE_DRIVER := make --no-print-directory twin-merge MERGE="%O %A %B %P"
HOOK_DECLARATION := --merge 'CHANGELOG.md=kit-changelog' --merge 'CHANGELOG.ko.md=kit-twin' \
	--merge 'docs/plans/*/checklist.md=kit-checklist' --merge 'docs/plans/*/checklist.ko.md=kit-twin' \
	--driver 'kit-twin=$(TWIN_MERGE_DRIVER)' --driver 'kit-changelog=$(TWIN_MERGE_DRIVER)' --driver 'kit-checklist=$(TWIN_MERGE_DRIVER)'
# make hooks declares the merges of the changelogs and the checklists (K354) in .git/info/attributes and the git config;
# git runs each driver as make twin-merge with MERGE="%O %A %B %P". hyper keeps no Git hook.
hooks: ## Declare the merge drivers of the changelogs and the checklists; offline
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install $(HOOK_DECLARATION)

hooks-check: ## Fail while the merge drivers of make hooks are not declared; offline
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check $(HOOK_DECLARATION)

twin-merge: ## The merge driver of a changelog or a checklist, which git runs with MERGE="<base> <ours> <theirs> <path>"; offline
	@$(NODE) $(KIT)/twin-merge.$(KIT_EXT) $(MERGE)

# ---- Plans, commits and documents (PRINCIPLES P24-P28) ---------------------------------------------------------------
# The texts of a row reach plan.mts unexpanded: each text that is set is passed as its raw value in single quotes (K457).
raw_text = $(foreach v,$(1),$(if $(filter undefined,$(origin $(v))),,$(v)='$(subst ','\'',$(value $(v)))'))
.PHONY: plan-new plan-split item-new item-edit item-state item-test commit documents-stamp docs-check
plan-new: ## Write the plan NAME with TITLE and TITLE_KO; offline
	NAME_PATTERN='^[a-z][a-z0-9-]*$$' $(NODE) $(KIT)/plan.$(KIT_EXT) plan-new

plan-split: ## Move the items IDS from the plan FROM to the plan TO; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) plan-split

item-new: ## Add the item ID to the checklist of PLAN with TASK, TASK_KO, DELIVERABLES and VERIFICATION; on main it commits with BODY_FILE; offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION) $(NODE) $(KIT)/plan.$(KIT_EXT) item-new

item-edit: ## Replace the cells of the item ID with TASK, TASK_KO, DELIVERABLES, VERIFICATION, or CAUSE, RETRY, CAUSE_KO and RETRY_KO; offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION CAUSE RETRY CAUSE_KO RETRY_KO) DONE_STAYS=1 $(NODE) $(KIT)/plan.$(KIT_EXT) item-edit

item-state: ## Move the item ID to STATE in both languages; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-state

item-test: ## Run the commands of the Verification cell of the item ID; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-test

commit: ## Commit the index for the item ID as TYPE(SCOPE): SUBJECT (#ID) with the body of BODY_FILE; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) commit

documents-stamp: ## Write the source-sha256 of each English document into the Korean twins of PATHS, or of every twin whose source moved; offline
	$(NODE) $(KIT)/documents-stamp.$(KIT_EXT) $(PATHS)

docs-check: ## Check the documents of config/documents.json: translation pairs, revisions, links and the checklists; offline
	$(NODE) $(KIT)/check-documents.$(KIT_EXT) --checklist-place --private-path /Users/ --private-path /home/ --kit-rows

# ---- Gates: the checkers of kit on this checkout (GATE_TARGETS) ------------------------------------------------------
.PHONY: layout-check owner-check owner-validate rebuild-check rules-check language-check duplication-check suppression-check lint-ts lint-php lint-python
layout-check: ## Check the folder layout against config/layout.yml with alint, that Git ignores each install directory and that no tracked file is generated; offline
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) installs var package.json=node_modules pyproject.toml=.venv composer.json=vendor
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) tracked --binary ELF --binary Mach-O --binary PE

owner-check: ## Run the checks of config/owner-checks.json that own the changed paths; PATHS="a b" or BASE=<revision> selects the paths
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) --every-path $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing checks; offline
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) --every-path --validate

# The tool sources of rebuild-check, the values that kit 0.0.98 fixed (kit K1080): the scripts and generators, each glob quoted.
REBUILD_SOURCES := --source 'scripts/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source '**/*_generate.go' --source '**/*.generate.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'benchmarks/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'examples/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'tests/fixtures/*/generate.*'
# The files among the sources that are no tool source (kit K1080): the .d.ts declarations and the tests.
REBUILD_EXCLUDES := --exclude '**/*.d.ts' --exclude '*/**/{test,tests}/**' --exclude 'test/**' --exclude 'tests/**/{*_generate.go,*.generate.*}' --exclude '**/*.{test,spec}.{js,jsx,ts,tsx,cjs,cts,mjs,mts}' --exclude '**/{*_test.go,test_*.py,*_test.py,*Test.php}'
rebuild-check: ## Check that every tool of config/rebuild.json has its class (S1); offline
	$(NODE) $(KIT)/rebuild-check.$(KIT_EXT) $(REBUILD_SOURCES) $(REBUILD_EXCLUDES)

rules-check: ## Check that every rule of PRINCIPLES.md and AGENTS.md names a check that a CI workflow runs (P3); offline
	$(NODE) $(KIT)/check-rules.$(KIT_EXT)

language-check: ## Fail on Hangul in a comment, an identifier, a message or a test name of the code; offline
	$(NODE) $(KIT)/language-check.$(KIT_EXT) --forbid '\p{Script=Hangul}'

duplication-check: ## Fail while a piece of 6 lines or more of code exists twice outside the folders of config/duplication.json; offline
	$(NODE) $(KIT)/duplication-check.$(KIT_EXT)

suppression-check: ## Fail on a suppression of a lint finding that states no reason; offline
	$(NODE) $(KIT)/suppression-check.$(KIT_EXT)


# The lint of each language reads the configuration of this repository: knip.json and .oxlintrc.json, phpcs.xml.dist and
# phpstan.dist.neon (also for packages/php, whose phpstan-max.neon only make analyse-php reads, H27.85), ruff.toml
# and [tool.vulture] of each pyproject.toml.
lint-ts: ## Lint the TypeScript: oxlint, knip and tsc of each project; offline
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'lint-ts needs the pinned TypeScript of scripts/recipe/typescript, whose declarations scripts/recipe/read-node.mts imports: run make install-packages'; exit 1; }
	$(NODE) $(KIT)/lint-ts.$(KIT_EXT)

lint-php: ## Lint the PHP: phpcs and PHPStan on each Composer package; offline
	$(NODE) $(KIT)/lint-php.$(KIT_EXT) --memory-limit=-1

lint-python: ## Lint the Python: ruff and vulture on each package; offline
	$(NODE) $(KIT)/lint-python.$(KIT_EXT)

# ---- CI reports (HR-91, HR-95) ---------------------------------------------------------------------------------------
.PHONY: ci-targets ci-summary ci-passed
CI_REPORT ?= var/report/ci-targets
ci-targets: ## Run TARGETS past failures and write CI_REPORT (logs, record.json, summary.md)
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) -k $(CI_REPORT) $(TARGETS)

ci-summary: ## Write summary.md of CI_REPORT again from its record, also for a run that stopped
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success
	$(NODE) $(KIT)/ci-passed.$(KIT_EXT)

# ---- Release (config/release.json) -----------------------------------------------------------------------------------
# The steps of .github/workflows/release.yml, in this order: release-tag tags the commit of the successful CI run RUN of ci.yml
# on main and appends TAG and VERSION to GITHUB_ENV; release-checkout checks that tag out; release-prepare installs as make
# hyper-install does; release-tools installs the tools of the release and release-tools-path puts them on the PATH of the
# later steps; release-assets builds the packages and their archives into var/release/assets; release-publish creates the
# draft GitHub Release and release-undraft makes it public.
.PHONY: release-tag release-checkout release-archive-tool release-prepare release-tools release-tools-path release-assets release-publish release-undraft release-coverage
release-tag: ## Tag the commit of the successful CI run RUN of ci.yml on main with vX.Y.Z of the change log; AUTO=1 releases only a version commit; reads the run with gh
	@test -n "$$RUN" || { echo "release-tag: RUN is required, for example make release-tag RUN=123"; exit 1; }
	RELEASE_MAIN=origin/main $(NODE) $(KIT)/release-run.$(KIT_EXT) tag "$$RUN"$(if $(AUTO), --auto)

release-checkout: ## Check out the tag TAG that release-tag created
	git checkout --quiet "$$TAG"

release-archive-tool: ## Fail unless Info-ZIP, which builds the Composer archives of the release, is on PATH
	@command -v zip >/dev/null || { echo 'release-archive-tool: Info-ZIP is required for the Composer release archives; install the zip package'; exit 1; }

release-tools: ## Install the tools that config/release.json needs for the release, with the Composer home of install-tools; ONLINE
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/release-tools.$(KIT_EXT)

release-tools-path: ## Append var/tools/bin and the shims of mise to GITHUB_PATH and the environment of mise to GITHUB_ENV
	@test -n "$$GITHUB_PATH" && test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_PATH and GITHUB_ENV are set only between the steps of a workflow'; exit 1; }
	@echo "$(KIT_TOOLS)/mise/shims" >> "$$GITHUB_PATH"
	@echo "$(KIT_TOOLS)/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

# The archives are built from the built packages, so release-assets builds them first.
release-assets: packages ## Build the archive of every package of TAG and packages.json into var/release/assets; ONLINE
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets $(ONLINE) $(NODE) $(KIT)/release.$(KIT_EXT) assets "$$TAG"

release-publish: ## Create the GitHub Release of TAG as a draft with the archives of release-assets
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.$(KIT_EXT) publish "$$TAG"

release-undraft: ## Make the draft release of TAG public
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.$(KIT_EXT) undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	$(NODE) $(KIT)/release.$(KIT_EXT) coverage
