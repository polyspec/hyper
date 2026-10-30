# Native npm installs the declared shared-tool package before make reads its installed bootstrap.
# A native local package link uses this same path; a sibling checkout is optional.
.PHONY: bootstrap
BOOTSTRAP_NPM := $(abspath $(shell command -v npm))
bootstrap: ## Bootstrap the lock with the declared native npm before installed tools exist
	npm_config_offline=false npm_config_cache="$$PWD/var/bootstrap/npm-cache" "$(BOOTSTRAP_NPM)" exec --yes --package="$$(node -p 'require("./package.json").packageManager.split("+")[0]')" -- npm ci --ignore-scripts --allow-remote=root

ifneq ($(filter bootstrap,$(MAKECMDGOALS)),)
ifneq ($(words $(MAKECMDGOALS)),1)
$(error Run make bootstrap alone before other goals)
endif
else
include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk
endif

BOARD := examples/board
PHP_PACKAGE := packages/server/php
JS_PACKAGE := packages/client
NODE_PACKAGE := packages/server/ts
BUILD_PACKAGE := packages/build
PYTHON_PACKAGE := packages/server/python
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
# The template repository of TEMPLATE_REPOSITORY supplies the tag checked before final verification (HR-80).
TEMPLATE_VERSION := 0.0.14
TEMPLATE_TAG := v$(TEMPLATE_VERSION)
TEMPLATE_PACKAGES := https://github.com/polyspec/template/releases/download/$(TEMPLATE_TAG)/packages.json
TEMPLATE_REPOSITORY := ../template
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The Composer vendor directory of the private root composer.json, which installs packages/server/php for development.
PHP_VENDOR := $(CURDIR)/vendor
# The native template extension, built from the unpacked php-ext asset (HY-48, H14.1-7).
# The lock of `make serve-demo`, whose fixed ports exist once on this machine (holder-lock of @polyspec/kit).
SERVE_DEMO_LOCK := /tmp/hyper-serve-demo.lock
# The TypeScript compiler of the bin link that npm writes (HR-79), by its absolute path, as NPM and COMPOSER_BIN.
TSC := $(CURDIR)/node_modules/.bin/tsc
# The esbuild package replaces bin/esbuild with the executable of the platform when it installs.
ESBUILD := node_modules/esbuild/bin/esbuild
# The path repository packages/server/php, which the board links with Composer (HR-79).
# The PHP memory limit of PHPStan: a run without its result cache (build/phpstan) needs 132 MB in its worker, above
# the default limit of 128M.
PHPSTAN_MEMORY := 256M
# The library of the native template extension that `make hyper-install` builds with PIE (H14.1-7, H27.45); PIE_WORK is the
# working directory of PIE, which holds the package that it fetched and its build.
EXT := build/ext/polyspec_template.so
PIE := $(KIT_TOOLS)/mise/shims/pie
PIE_WORK := $(CURDIR)/var/pie

# The toolchain (HR-81, install-tools of @polyspec/kit): npm and Composer of the checkout ($(KIT_TOOLS) of kit.mk, its own var/tools in a
# linked worktree too, kit K858), which `make install-tools` installs into its var/tools, come first on PATH for every recipe
# and the programs that it starts.
export PATH := $(KIT_TOOLS)/bin:$(PATH)
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

.PHONY: help hyper-install hyper-install-python hyper-install-browser hyper-install-virtiofs hyper-test-node hyper-test-python-render hyper-test-scripts check typecheck hyper-server-php-install template-tag ext packages package-check server server-fixtures node-server node-fixtures assets hyper-test-js hyper-test-php hyper-test-python hyper-lint analyse-php templates-check virtiofs-check parity server-parity server-parity-python bundle-size e2e serve-demo bench-server bench-server-smoke bench-browser bench serve-demo-unlock

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

hyper-install: install-kit ## Install the pinned tools, fetch the archives of the template release and install the Composer dependencies; make install-packages installs the npm packages (HR-89, H14.1-7)
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT)
	$(MAKE) --no-print-directory hyper-install-php
	$(MAKE) --no-print-directory hyper-install-python

.PHONY: hyper-install-php node-toolchain-check php-toolchain-check python-toolchain-check
hyper-install-php: php-toolchain-check ## Install only the locked root and board Composer projects and their pinned PHP archives
	$(MAKE) --no-print-directory template-ext
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction --working-dir=$(BOARD)

node-toolchain-check: ## Verify the Node tools used by workspace builds and checks
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT) node npm

php-toolchain-check: ## Verify the PHP tools used by Composer and PHP checks
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT) php composer

python-toolchain-check: ## Verify the Python tools used by locked Python environments
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT) python uv

hyper-install-python: python-toolchain-check ## Make the venv of the Python server package anew and install the package into it non-editable with its dependencies (S5)
	rm -rf $(PYTHON_VENV)
	$(MAKE) --no-print-directory python-venv DIR=$(PYTHON_VENV)
	$(ONLINE) $(UV) sync --quiet --locked --no-editable --project $(PYTHON_PACKAGE)

hyper-install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HR-91)
	$(ONLINE) $(NODE) node_modules/@playwright/test/cli.js install --with-deps chromium

hyper-install-virtiofs: ## Install the digest-pinned image for Darwin virtiofs verification
	$(ONLINE) container image pull --platform linux/arm64 $(VIRTIOFS_IMAGE)

# Native development graphs have their own manifests and locks; release declarations remain separate.
.PHONY: composer-development
composer-development: ## Resolve declared PHP development sources through native Composer
	COMPOSER=composer.local.json $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(MAKE) --no-print-directory composer-install DIR=. CHECKOUTS="$(CURDIR) $(abspath ../template) $(abspath ../forks/json-schema)"
	COMPOSER=composer.local.json $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(MAKE) --no-print-directory composer-install DIR=$(BOARD) CHECKOUTS="$(CURDIR) $(abspath ../template) $(abspath ../forks/json-schema)"

.PHONY: composer-development-check
composer-development-check: ## Validate selected native PHP development locks and their actual runtime requirements
	@test -f composer.local.lock -a -f $(BOARD)/composer.local.lock || { echo "composer-development-check: make composer-development creates both development locks" >&2; exit 1; }
	@failed=; \
	$(call check,root development lock,COMPOSER=composer.local.json $(COMPOSER_BIN) validate --strict) \
	$(call check,board development lock,COMPOSER=composer.local.json $(COMPOSER_BIN) validate --strict --working-dir=$(BOARD)) \
	$(call check,root development platform,COMPOSER=composer.local.json $(COMPOSER_BIN) check-platform-reqs --lock) \
	$(call check,board development platform,COMPOSER=composer.local.json $(COMPOSER_BIN) check-platform-reqs --lock --working-dir=$(BOARD)) \
	$(call check,development source records,$(NODE) scripts/check-composer-development.mts --root .) \
	$(checks_result)

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

# Fails when the template checkout has no tag TEMPLATE_TAG (HR-80).
template-tag: ## Fail when the template repository TEMPLATE_REPOSITORY has no tag TEMPLATE_TAG, naming the expected tag and the tags it has (HR-80)
	@git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}' >/dev/null || { \
	  echo "template-tag: $(TEMPLATE_REPOSITORY) has no tag $(TEMPLATE_TAG): expected the tag $(TEMPLATE_TAG), actual tags: $$(git -C $(TEMPLATE_REPOSITORY) tag --list 2>/dev/null | tr '\n' ' ')" >&2; \
	  echo "template-tag: fetch the tags of the template repository with git -C $(TEMPLATE_REPOSITORY) fetch --tags" >&2; \
	  exit 1; }

# PIE resolves polyspec/template-php-ext TEMPLATE_VERSION in the Composer repository TEMPLATE_PACKAGES, which checks the sha1 of
# its zip, and builds it with phpize and the php-config of the PHP of PATH into the vendor directory of PIE_WORK: the folder
# of the package, its build-path src and the modules folder of phpize. The library is published into build/ext with a rename
# (scripts/publish.mts, HR-82). `pie build` installs nothing into the PHP; the checks load the library with -d extension.
# The recipe installs http:pie of mise.toml itself, with its locked checksum: a CI job installs only the TOOLS of its matrix,
# and install-tools of kit has no pie selector, so no TOOLS list can name it (H27.45-1).
.PHONY: template-ext
template-ext: php-toolchain-check ## Build the native template extension of TEMPLATE_TAG with PIE from the Composer repository of the template release into build/ext (H27.45); ONLINE
	$(ONLINE) $(KIT_TOOLS)/bin/mise install --locked http:pie
	PIE_WORKING_DIRECTORY=$(PIE_WORK) $(ONLINE) $(PIE) repository:add composer $(TEMPLATE_PACKAGES) --no-interaction
	PIE_WORKING_DIRECTORY=$(PIE_WORK) $(ONLINE) $(PIE) build polyspec/template-php-ext:$(TEMPLATE_VERSION) --no-interaction
	@set -- $(PIE_WORK)/*/vendor/polyspec/template-php-ext/src/modules/polyspec_template.so; \
	  test $$# -eq 1 && test -f "$$1" || { echo "template-ext: expected one library polyspec_template.so of PIE in $(PIE_WORK), found: $$*" >&2; exit 1; }; \
	  mkdir -p build/ext.next-$$$$ && cp "$$1" build/ext.next-$$$$/polyspec_template.so && $(NODE) scripts/publish.mts directory build/ext.next-$$$$ build/ext

# The checks load the library that `make hyper-install` built with PIE (template-ext); they run offline and build nothing.
ext: ## Fail unless the native template extension of make template-ext is in build/ext (HY-48, H14.1-7, H27.45)
	@test -f $(EXT) || { echo "ext: $(EXT) does not exist; run make hyper-install, which builds it with PIE (make template-ext)" >&2; exit 1; }

packages: node-toolchain-check ## Build the JavaScript modules and type declarations of the npm packages into their dist directories; npm links the workspaces (HR-61, HR-79, HR-96)
	cd $(JS_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist
	cd $(NODE_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && $(NODE) $(CURDIR)/scripts/publish.mts directory dist.next-$$$$ dist

# The path repository of the board links the PHP server package to packages/server/php (Composer's default, HR-79), so the
# board runs the current source without a copy. The install reads no registry: the targets of the checks reach it, so Composer
# installs offline from the cache that make hyper-install filled (HR-89), and make link then links the polyspec packages that a
# sibling checkout provides (K448).
hyper-server-php-install: ## Install the Composer dependencies of the board offline, which link polyspec/hyper-server to packages/server/php (HR-79), and link the sibling polyspec packages
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction --working-dir=$(BOARD)
	$(MAKE) --no-print-directory link PROJECT=$(BOARD)

# package-check is a check, so it installs offline from the npm cache that make hyper-install filled and fails by the name of a
# package that the cache lacks (HR-89); npm alone owns the links and installed records of this declared consumer graph.
package-check: packages node-fixtures ## Install the npm packages into tests/package-install offline, link them, type-check its test against their declarations and run it under node (HR-61)
	NPM_BIN=$(NPM) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(NODE) $(KIT)/npm-install.$(KIT_EXT) tests/package-install "$(CURDIR)" "$(realpath node_modules/@polyspec/template)"
	$(TSC) -p tests/package-install/tsconfig.json
	NPM_BIN=$(NPM) $(NODE) $(KIT)/run-tests.$(KIT_EXT) node --cwd tests/package-install -- package-install.test.ts

server: packages ## Build the board server program from installed dependencies: its templates and generated PHP program (HY-48)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

server-fixtures: packages ## Build the server program of the PHP test fixtures
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-server.mjs --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --php-namespace 'Polyspec\Hyper\Tests\Program'

node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: packages ## Build the template files of the PHP test fixtures for the Node server tests
	$(NODE) scripts/build-templates.mts --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build

# Shared gates read the declarations and runtime fixtures built by this checkout.
lint-ts parity-declarations-check: packages
parity-check: server-fixtures node-fixtures

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper-build-assets.mjs --app $(BOARD) --api /api --output $(BOARD)/build --static public/assets/app.css --static public/assets/reader.css

hyper-test-js: node-toolchain-check ## Run the browser code tests, including the router conformance cases, and the type check
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

.PHONY: python-file-parts-test
python-file-parts-test: server-fixtures python-toolchain-check ## Run Python multipart unit and rendering cases (HY-113, HY-114)
	@failed=; \
	$(call check,multipart contract cases,$(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p test_files.py) \
	$(call check,multipart application cases,$(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests/render -t $(PYTHON_PACKAGE) -p render_files.py) \
	$(checks_result)

hyper-test-python: python-toolchain-check ## Run the Python server package tests, which read the conformance cases of routes, rest, csrf, fields and json
	@failed=; \
	$(call check,Python protocol unit tests,$(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p 'test_*.py') \
	$(call check,Python package data tests,$(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s tests/python_package -p 'test_*.py') \
	$(checks_result)

# The rendering tests need the template Python package (H15.3-3), the wheel of the template release that the venv of make
# install holds, and `make server-fixtures` writes the server program they open.
hyper-test-python-render: server-fixtures python-toolchain-check ## Run the Python rendering tests with the template package of the venv (H15.3-3)
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests/render -t $(PYTHON_PACKAGE) -p 'render_*.py'

hyper-lint: php-toolchain-check ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: ext ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: node-toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	$(NODE) scripts/check-templates.mts --app $(BOARD)

# The TypeScript of scripts/, tests/ and benchmarks/ (tsconfig.json), which Node runs by type stripping and so never checks
# itself (S9 of kit). scripts/check-parity.mts imports the types of @polyspec/hyper-client, which the package's build writes
# to its dist, so packages runs first.
typecheck: packages ## Check the types of the TypeScript of scripts/, tests/ and benchmarks/ with the tsc of node_modules (tsconfig.json)
	$(TSC) -p tsconfig.json

.PHONY: toolchain-policy-test
toolchain-policy-test: ## Verify the declared toolchain and offline recipe policy
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- tests/scripts/toolchain.test.mts

hyper-test-scripts: packages assets server ## Run the tests of the check scripts, or only the files of TESTS
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

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run; CASES=<pattern> runs the cases whose title matches
	$(NODE) scripts/run-e2e.mts -- $(NODE) $(KIT)/run-tests.$(KIT_EXT) playwright -- --config tests/e2e/playwright.config.ts$(if $(CASES), --grep '$(CASES)')

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

# The final suite runs through the native kit report runner on a clean committed tree.
# Run it once after checklist development, then rerun only failed owners.
CHECK_TARGETS := kit-check suppression-check toolchain-check layout-check typecheck lint-ts docs-check hooks-check owner-validate bench-server-smoke hyper-lint analyse-php templates-check hyper-test-scripts hyper-test-js hyper-test-node hyper-test-python hyper-test-python-render package-check hyper-test-php parity server-parity server-parity-python bundle-size e2e rules-check rebuild-check language-check test-markers-check duplication-check parity-declarations-check parity-check lint-php lint-python bypass-check divergence-check

# The CI groups of the full suite (HR-91) are the entries of the matrix of .github/workflows/ci.yml: each entry runs its
# `targets` with `make ci-targets`, so the entries together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mts). An entry gathers the targets that need the same setup: docs only Node.js, php and
# node PHP, the template build and the install, board also Chromium, python only the Python of its pins.

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mts). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
VIRTIOFS_IMAGE := docker.io/library/node:26.8.1-trixie-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

check: template-tag ## Run final verification once after checklist development, on a clean committed tree
	FINAL_RUN=1 $(NODE) $(KIT)/ci-targets.$(KIT_EXT) var/report/full-run $(CHECK_TARGETS)



# The steps of .github/workflows/release.yml for the tag TAG (release of @polyspec/kit, config/release.json), in this order:
# release-verify requires the tagged commit on origin/main with the check ci-passed passed, release-assets builds the packages and their archives into
# var/release/assets, and release-publish creates the GitHub Release. The targets are those of the kit.mk of @polyspec/kit; the
# archives are built from the built packages, so release-assets builds them first.
release-assets: packages

.PHONY: hyper-runner-owner-check
hyper-runner-owner-check: ## Verify application test entry points through the shared test runner
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- tests/scripts/check-recipes.test.mts tests/scripts/ci-workflow.test.mts tests/scripts/run-e2e.test.mts
