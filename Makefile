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
# check. A recipe that uses them starts with `@failed=; \` and joins its checks with `\`. No check of such a recipe is a
# make: make runs a recipe line that names $(MAKE) in a dry run too, with every command of that line (HR-83). A check
# that a target also runs is a variable that holds its command, which the target and the recipe of the checks both name
# (recipe-check).
check = echo '$(2)'; $(NODE) scripts/line-end.mts '$(2)' || failed="$$failed $(1);";
checks_result = test -z "$$failed" || { echo "failed checks:$$failed"; exit 1; }

.DEFAULT_GOAL := help

# The PHP of the checkout is var/tools/bin/php, the wrapper that make install-tools writes for the php that is first on
# PATH at that time and that a later install keeps (kit K1271), so the wrapper can run another minor release than
# .php-version pins (HR-81). php-check compares the two before a recipe starts PHP: PHP_TARGETS are the targets whose
# recipes start PHP, Composer, PIE, PHPUnit, PHPStan, phpcs, Pint, a PHP server or a build against the headers of PHP,
# and php-check is a prerequisite of each, so no such recipe runs on another PHP; make orders the prerequisites of the
# rule that holds the recipe first, so a prerequisite that starts no PHP may run before the check. make install-tools runs
# the same check after it wrote or kept the wrapper, with php-check-installed, which passes for a checkout without the
# wrapper, since an install of tools that need no PHP writes none. The condition is a line of the recipe of that target
# and not of the line that starts its make, so a dry run of install-tools prints the condition and runs no command
# (HR-83). hyper-install is no such target: its first step writes the wrapper.
# A target that starts PHP is named here, and tests/scripts/php-check.test.mts fails for a PHP recipe that is not.
CHECKOUT_PHP := $(KIT_TOOLS)/bin/php
PHP_TARGETS := hyper-install-php template-ext json-ext hyper-install-redis install-symbols hyper-ext hyper-php-install hyper-test-php hyper-lint analyse-php lint-php hyper-test-scripts recipe-run-php recipe-check recipe-compare recipe-candidates lint-bindings test-bindings parity server-parity server-parity-python e2e serve-demo bench-server bench-server-smoke bench-browser bench-uploads bench-sessions
.PHONY: php-check php-check-installed
$(PHP_TARGETS): php-check
php_check = want="$$(tr -d '[:space:]' < .php-version)"; \
	test -x $(CHECKOUT_PHP) || { echo "php-check: $(CHECKOUT_PHP), the PHP of the checkout, does not exist; put the php of PHP $$want first on PATH (Homebrew: php@$$want) and run make install-tools" >&2; exit 1; }; \
	have="$$($(CHECKOUT_PHP) -n -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;')" || { echo "php-check: $(CHECKOUT_PHP) does not run; remove it, put the php of PHP $$want first on PATH (Homebrew: php@$$want) and run make install-tools" >&2; exit 1; }; \
	test "$$have" = "$$want" || { echo "php-check: $(CHECKOUT_PHP) runs PHP $$have ($$($(CHECKOUT_PHP) -n -r 'echo PHP_VERSION, " at ", PHP_BINARY;')), and .php-version names PHP $$want. make install-tools keeps an existing wrapper: put the php of PHP $$want first on PATH (Homebrew: php@$$want), remove $(CHECKOUT_PHP) and run make install-tools, then make hyper-install-php and make hyper-ext, which build the extensions for that PHP" >&2; exit 1; }
php-check: ## Fail unless var/tools/bin/php, the PHP of the checkout, is the minor release that .php-version names (HR-81)
	@$(php_check)
php-check-installed: ## Run the check of php-check where var/tools/bin/php exists; pass for a checkout without it
	@test ! -e $(CHECKOUT_PHP) || { $(php_check); }

.PHONY: bench-sessions bench-uploads help hyper-install hyper-install-python hyper-install-browser hyper-install-virtiofs hyper-test-node hyper-test-python-render hyper-test-scripts check typecheck hyper-php-install ext packages package-check board server-fixtures contract-programs node-server node-fixtures hyper-test-js hyper-test-php hyper-test-python hyper-lint analyse-php templates-check virtiofs-check parity server-parity server-parity-python bundle-size e2e serve-demo bench-server bench-server-smoke bench-browser bench serve-demo-unlock

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

# The install order of a checkout: the mise, node and npm of mise.toml (the bootstrap of install-tools), the packages of
# package-lock.json with that npm, then the other tools of mise.toml, the symbol extractor of PHP, whose php-parser
# lint-php reads, and the Composer projects and the venv of hyper.
hyper-install: ## Install the pinned tools and the npm packages, the sources that the binding generator of package.json writes, fetch the archives of the template release and install the Composer dependencies and the Python venv (HR-89, H14.1-7, H35.1); ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory install-symbols EXTRACTORS=php
	$(MAKE) --no-print-directory hyper-install-crates
	$(MAKE) --no-print-directory bindings
	$(MAKE) --no-print-directory node-addon
	$(MAKE) --no-print-directory hyper-ext
	$(MAKE) --no-print-directory hyper-install-php
	$(MAKE) --no-print-directory hyper-install-python

# The crates of Cargo.lock (HR-89): hyper-install-crates is the one target that downloads them, the git tags of the
# polyspec crates and the crates of crates.io, with `cargo fetch --locked` through the link script, which fetches for
# every target of the lock, wasm32 among them. Every other recipe starts cargo with --offline, as maturin of
# hyper-install-python and the binding generator do, so no check downloads a crate in one run and not in another.
# crates-check is a prerequisite of each target of CRATE_TARGETS, the targets whose recipes start cargo, maturin or the
# binding generator: it reads the packages of the lock offline, as the binding generator does, and fails with the name
# of the install target when one is not fetched, so the failure is not the advice of cargo to leave the offline mode.
# A target that starts cargo is named here and in the setup of its CI group, and tests/scripts/ci-group-tools.test.mts
# fails for a group that starts one of them before hyper-install-crates.
CRATE_TARGETS := hyper-install-python hyper-ext core-test core-lint bindings bindings-check lint-bindings test-bindings node-addon node-package test-go
.PHONY: hyper-install-crates crates-check
$(CRATE_TARGETS): crates-check
hyper-install-crates: ## Fetch the crates that Cargo.lock pins, which every other recipe reads offline (HR-89); ONLINE
	$(ONLINE) $(CARGO) fetch --locked
crates-check: ## Fail unless every crate that Cargo.lock pins is fetched, naming make hyper-install-crates (HR-89)
	@$(CARGO) metadata --locked --offline --format-version 1 > /dev/null || { echo "crates-check: a crate that Cargo.lock pins is not fetched, or the lock does not match the manifests; run make hyper-install-crates" >&2; exit 1; }

.PHONY: hyper-install-php
hyper-install-php: ## Install only the locked root and board Composer projects and their pinned PHP archives
	$(MAKE) --no-print-directory json-ext
	$(MAKE) --no-print-directory template-ext
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction
	$(ONLINE) $(NODE) $(KIT)/holder-lock.$(KIT_EXT) run $(INSTALL_LOCK) -- $(COMPOSER_BIN) install --no-interaction --working-dir=$(BOARD)

# uv sync installs the locked dependencies without the project, because its build backend runs maturin with plain cargo,
# which applies no patch of .links and resolves two binding-core crates. The package with its native module is the wheel
# that maturin of mise.toml builds through the link script of kit, which passes the patches to the cargo that maturin runs
# (K1266), into a staging directory of the process that the shell removes when it ends (HR-87); uv installs that wheel
# into the venv without its dependencies.
MATURIN := $(KIT_TOOLS)/mise/shims/maturin
hyper-install-python: ## Make the venv of the Python server package anew and install the package into it non-editable with its dependencies (S5, H35.24)
	rm -rf $(PYTHON_VENV)
	$(NODE) $(KIT)/python-venv.$(KIT_EXT) $(PYTHON_VENV)
	UV_SYNC='--locked --quiet --no-editable --no-install-project --project $(PYTHON_PACKAGE)' $(ONLINE) $(NODE) $(KIT)/uv-install.$(KIT_EXT) .
	wheels=$(CURDIR)/var/python-wheel.next-$$$$ && trap 'rm -rf '"$$wheels" EXIT && trap 'exit 130' INT TERM && MATURIN=$(MATURIN) $(NODE) $(KIT)/link.$(KIT_EXT) maturin $(CURDIR)/$(PYTHON_PACKAGE) build --locked --offline --out "$$wheels" && $(UV) pip install --offline --python $(PYTHON_VENV)/bin/python --no-deps --reinstall "$$wheels"/*.whl

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

# The template extension requires the json extension polyspec_json (ext-polyspec_json), which PHP loads before it. PIE gets
# polyspec/json JSON_VERSION from the Composer repository JSON_PACKAGES of the json release, as template-ext gets the
# template extension, and the library is published into build/json-ext with a rename (HR-82).
JSON_VERSION := 0.0.34
JSON_PACKAGES := https://github.com/polyspec/json/releases/download/v$(JSON_VERSION)/packages.json
JSON_EXT := build/json-ext/polyspec_json.so
JSON_PIE_WORK := $(CURDIR)/var/pie/polyspec/json
.PHONY: json-ext
json-ext: ## Get the json extension polyspec_json of JSON_VERSION with PIE from the Composer repository of the json release into build/json-ext (H35.31); ONLINE
	rm -rf $(JSON_PIE_WORK) && mkdir -p $(JSON_PIE_WORK)
	$(ONLINE) env PIE_WORKING_DIRECTORY=$(JSON_PIE_WORK) $(PIE) repository:add composer $(JSON_PACKAGES) --no-interaction
	$(ONLINE) env PIE_WORKING_DIRECTORY=$(JSON_PIE_WORK) $(PIE) build polyspec/json:$(JSON_VERSION) --no-interaction
	@binary=$$($(NODE) scripts/pie-binary.mts $(JSON_PIE_WORK) polyspec/json) || exit $$?; \
	  mkdir -p build/json-ext.next-$$$$ && trap 'rm -rf build/json-ext.next-$$$$' EXIT && trap 'exit 130' INT TERM && cp "$$binary" build/json-ext.next-$$$$/polyspec_json.so && $(NODE) scripts/publish.mts directory build/json-ext.next-$$$$ build/json-ext

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

# The template extension that the PHP checks load. In a linked run `make link` links vendor/polyspec/template to the
# packages/php-ext of a template checkout, and the checks load the library that the checkout builds into its
# target/release; otherwise they load the library of template-ext. PHP_EXTENSIONS lists the json extension before the
# template extension, which requires it (HY-48.15).
TEMPLATE_LINKED_EXT = $(wildcard $(realpath $(PHP_VENDOR)/polyspec/template)/../../target/release/libpolyspec_template.$(CDYLIB))
PHP_TEMPLATE_EXT = $(or $(TEMPLATE_LINKED_EXT),$(abspath $(EXT)))
PHP_EXTENSIONS = $(abspath $(JSON_EXT)) $(PHP_TEMPLATE_EXT)

# The checks load the libraries that `make hyper-install` built with PIE (json-ext, template-ext) or the linked template
# library; they run offline and build nothing.
ext: ## Fail unless the json extension and the template extension that the PHP checks load exist (HY-48.15, H14.1-7, H27.45)
	@for library in $(PHP_EXTENSIONS); do test -f "$$library" || { echo "ext: $$library does not exist; run make hyper-install-php, which builds it with PIE (make json-ext, make template-ext)" >&2; exit 1; }; done

# The PHP extension polyspec_hyper of the server (HY-132.2) for development: packages/php/native, built through $(CARGO),
# which applies the patches of .links, against the php and the php-config of the checkout, with the libclang and the
# clang of the LLVM of config/toolchain.json (LLVM_ROOT of packages/release.mk), as release-php-ext builds it for a
# release. The library is checked to load into that PHP without a php.ini and published into build/hyper-ext with one
# rename (HR-82); the PHP tests and the session holders load it with -d extension.
# The PHP is an input of the build: the build script of ext-php-rs writes the bindings and the module API of the headers
# that php-config names into the library, and Cargo runs it again only when a variable that it declares with
# rerun-if-env-changed changes. PHP and PHP_CONFIG name the wrappers of var/tools/bin, whose paths stay when the PHP
# behind them changes, so Cargo would keep the library of the PHP before it. The output therefore names its input
# (HR-80): every cargo command that compiles the crate of the extension, the build of hyper-ext and the clippy and the
# tests of the bindings, runs in the target directory of the API of that PHP, $(CARGO_TARGET)/php-<headers><build>,
# where <headers> is the release of the headers (php-config --vernum) and <build> the debug build and the thread safety
# as release-php-ext of packages/release.mk writes them (-nts, -zts, -debug-nts, -debug-zts). $(php_api_target) sets the
# shell variable target to that directory, and the link script of kit passes CARGO_TARGET_DIR on to cargo as it is.
# Another PHP builds in another directory, so no library of another API is copied, and no recipe removes a target
# directory. hyper-ext is a prerequisite of each target that loads build/hyper-ext, so the library that a target loads
# is the one of the PHP of the checkout at that run, which the recipe loaded into that PHP before it published it.
HYPER_EXT := build/hyper-ext/polyspec_hyper.so
php_api_target = headers="$$(php-config --vernum)" && build="$$(php -n -r 'echo PHP_DEBUG ? "-debug" : "", "-", PHP_ZTS ? "zts" : "nts";')" && target="$(CARGO_TARGET)/php-$$headers$$build"
PHP_EXT_CARGO = $(php_api_target) && CARGO_TARGET_DIR="$$target" $(CARGO)
.PHONY: hyper-ext
hyper-ext: bindings ## Build the PHP extension polyspec_hyper of packages/php/native into build/hyper-ext (HY-132.2, H35.25)
	@test -n "$(LLVM_MAJOR)" || { echo 'hyper-ext: LLVM_MAJOR is empty, since packages/release.mk, which make release-recipes writes, is missing' >&2; exit 2; }
	@test -x "$(LLVM_ROOT)/bin/clang" && ls "$(LLVM_ROOT)/lib" 2>/dev/null | grep -q '^libclang' || { echo 'hyper-ext: the bindgen of ext-php-rs needs the libclang and the clang of LLVM $(LLVM_MAJOR) (config/toolchain.json) in $(LLVM_ROOT)' >&2; exit 2; }
	$(php_api_target) && PHP="$$(command -v php)" PHP_CONFIG="$$(command -v php-config)" LIBCLANG_PATH=$(LLVM_ROOT)/lib CLANG_PATH=$(LLVM_ROOT)/bin/clang CARGO_TARGET_DIR="$$target" $(CARGO) build --locked --offline -p polyspec-hyper-php-ext
	$(php_api_target) && mkdir -p build/hyper-ext.next-$$$$ && trap 'rm -rf build/hyper-ext.next-$$$$' EXIT && trap 'exit 130' INT TERM && cp "$$target/debug/libpolyspec_hyper.$(CDYLIB)" build/hyper-ext.next-$$$$/polyspec_hyper.so && php -n -d extension=$(CURDIR)/build/hyper-ext.next-$$$$/polyspec_hyper.so -r 'exit(extension_loaded("polyspec_hyper") ? 0 : 1);' && $(NODE) scripts/publish.mts directory build/hyper-ext.next-$$$$ build/hyper-ext

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

# The program assembly of the command tool writes reads.json with the Rust core (HY-73.23), through the entry
# @polyspec/hyper/build of the Node package, so each target that writes a server program needs the dist of `packages`
# and the Node addon of this platform (`node-addon`).
server-fixtures: packages node-addon contract-programs ##Build the server program of the PHP test fixtures with the fixed build id of their build.json (HY-48, HY-125.21)
	$(NODE) scripts/fixture-program.mts --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --php-namespace 'Polyspec\Hyper\Tests\Program' --id-file $(FIXTURES)/build.json

contract-programs: packages node-addon ##Build the applications of contracts/context.json, contracts/functions.json, contracts/representations.json and contracts/app.json and one application per case of contracts/reads.json for the tests of the three servers (HY-73, HY-118, HY-124, HYC-24)
	$(NODE) scripts/contract-programs.mts --contract $(abspath contracts/context.json) --contract $(abspath contracts/functions.json) --contract $(abspath contracts/representations.json) --contract $(abspath contracts/app.json) --reads $(abspath contracts/reads.json) --output $(abspath var/contract-programs)

# A Node server bundle keeps the packages of node_modules external, and Node loads them from there: a CommonJS package that
# requires Node modules cannot run inside an ESM bundle.
node-server: board node-addon ## Build the board Node server into examples/board/build/node/server.mjs, which loads the Node addon of this platform (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --packages=external --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: packages contract-programs ## Build the template files of the PHP test fixtures for the Node server tests
	$(NODE) scripts/build-templates.mts --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build

# Shared gates read the declarations and runtime fixtures built by this checkout.
lint-ts: packages

board: packages node-addon ##Build the board with one run of hyper build: public/assets, build/client with the static shell, and build/program with the generated PHP program (HR-34, HY-48, HY-125)
	$(NODE) $(BUILD_PACKAGE)/bin/hyper.mjs build --app $(BOARD) --output $(BOARD)/build --api /api --php-namespace 'Polyspec\Hyper\Examples\Board\Program' --static public/assets/app.css --static public/assets/reader.css --static public/assets/reader.js --static public/assets/after-reader.js

# A selection of cases (H35.9-11): CASES="<name> ..." of hyper-test-js, hyper-test-node, hyper-test-php and
# hyper-test-python names the cases that the case runner of the target runs, each name a case file (reads.json), a
# section of a case file (app.json#opens) or a case id. With a selection the recipe of the target is one command, the
# case runner alone (case_run_*), so no other test and no type check of the target runs; its prerequisites are built
# as for a full run. The runner reads the selection from RECIPE_CASES and writes <runner>.selected.txt, whose first
# line states the selection, so <runner>.txt holds a full run only, which recipe-check reads. A name that selects no
# case of the runner fails the run (HR-84). recipe-check and the targets recipe-run-* set no RECIPE_CASES, so they run
# every case whatever CASES holds.
cases_selected = RECIPE_CASES='$(strip $(CASES))' RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/$(1).selected.txt

# A selection of unit test files (H35.9-14): PHP_TESTS, NODE_TESTS and PYTHON_TESTS of hyper-test-php, hyper-test-node
# and hyper-test-python name test files by their paths below the package of the target, such as tests/http.test.ts,
# as JS_TESTS does for hyper-test-js. With a selection the recipe runs those files alone with the test runner of the
# target, without the type check and the other test runs; its prerequisites are built as for a full run. tests_guard
# runs first: it fails the target when CASES is set too, since a run selects cases or files, and when a path names no
# file of the package, so a selection that selects nothing fails before the runner starts (HR-84). A case runner among
# the files writes <runner>.files.txt, so <runner>.txt holds a full run only, which recipe-check reads.
tests_guard = @test -z '$(strip $(CASES))' || { echo "$@: CASES and $(1) are both set: a run selects cases or test files, not both"; exit 1; }; for file in $(strip $($(1))); do test -f $(2)/$$file || { echo "$@: the selection $(1)=\"$(strip $($(1)))\" names no test file $(2)/$$file (HR-84)"; exit 1; }; done; mkdir -p $(RECIPE_RESULTS_DIR)
tests_selected = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/$(1).files.txt

hyper-test-js: ## Run the browser code tests, including the browser case runner (HYR-7), and the type check; CASES="<file|file#section|id> ..." runs only those cases of the case runner
ifeq ($(strip $(CASES)),)
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,the tests of $(JS_PACKAGE),RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/browser.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(JS_PACKAGE)$(if $(JS_TESTS), -- $(JS_TESTS))) \
	$(call check,the type check of $(JS_PACKAGE),$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json) \
	$(checks_result)
else
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(call cases_selected,browser) $(case_run_browser)
endif

hyper-test-node: packages node-fixtures node-addon ## Run the Node server tests, including the case runner (HYR-7), and the type check; CASES="<file|file#section|id> ..." runs only those cases of the case runner; NODE_TESTS="<path> ..." runs only those test files of the package
ifneq ($(strip $(NODE_TESTS)),)
	$(call tests_guard,NODE_TESTS,$(NODE_PACKAGE))
	$(call tests_selected,node) node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE) -- $(strip $(NODE_TESTS))
else ifeq ($(strip $(CASES)),)
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,the tests of $(NODE_PACKAGE),RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/node.txt node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE)) \
	$(call check,the type check of $(NODE_PACKAGE),$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json) \
	$(checks_result)
else
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(call cases_selected,node) $(case_run_node)
endif

# PHP loads the json extension, then the template extension, then polyspec_hyper (HY-48.15, HY-132.2). Every PHP server
# of a check, a test and the demo loads PHP_SERVER_EXTENSIONS: scripts take them as --extension arguments, and the tests
# of hyper-test-scripts read them from HYPER_PHP_EXTENSIONS.
PHP_SERVER_EXTENSIONS = $(PHP_EXTENSIONS) $(abspath $(HYPER_EXT))
PHP_SERVER_ARGUMENTS = $(foreach library,$(PHP_SERVER_EXTENSIONS),--extension $(library))
PHPUNIT_EXTENSIONS = $(foreach library,$(PHP_SERVER_EXTENSIONS),--php-extension $(library))
hyper-test-php: server-fixtures ext hyper-ext ## Run the server package tests, the case runner included (HYR-7), with the json, the template and the hyper extensions; CASES="<file|file#section|id> ..." runs only those cases of the case runner; PHP_TESTS="<path> ..." runs only those test files of the package
	@mkdir -p $(RECIPE_RESULTS_DIR)
ifneq ($(strip $(PHP_TESTS)),)
	$(call tests_guard,PHP_TESTS,$(PHP_PACKAGE))
	$(call tests_selected,php) COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) $(PHPUNIT_EXTENSIONS) -- $(strip $(PHP_TESTS))
else ifeq ($(strip $(CASES)),)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/php.txt COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) $(PHPUNIT_EXTENSIONS)
else
	$(call cases_selected,php) $(case_run_php)
endif

hyper-test-python: server-fixtures ## Run the Python server package tests, the case runner included (HYR-7); CASES="<file|file#section|id> ..." runs only those cases of the case runner; PYTHON_TESTS="<path> ..." runs only those test files of the package
ifneq ($(strip $(PYTHON_TESTS)),)
	$(call tests_guard,PYTHON_TESTS,$(PYTHON_PACKAGE))
	@failed=; $(foreach file,$(strip $(PYTHON_TESTS)),$(call check,$(file),$(call tests_selected,python) PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/$(patsubst %/,%,$(dir $(file))) -t $(PYTHON_PACKAGE) -p $(notdir $(file)))) $(checks_result)
else ifeq ($(strip $(CASES)),)
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,Python protocol unit tests,RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/python.txt PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p 'test_*.py') \
	$(call check,Python package data tests,PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s tests/python_package -p 'test_*.py') \
	$(checks_result)
else
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(call cases_selected,python) $(case_run_python)
endif

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
hyper-test-scripts: packages board node-server ext hyper-ext ## Run the tests of the check scripts, the build case runner included (HYR-7), or only the files of TESTS
	@mkdir -p $(RECIPE_RESULTS_DIR)
	RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/build.txt HYPER_PHP_EXTENSIONS='$(PHP_SERVER_EXTENSIONS)' $(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 $(or $(TESTS),$(wildcard tests/scripts/*.test.mts))

# The recipe check (HYR-8) and the candidate of its spec (HYR-10). The TypeScript reader needs the pinned TypeScript of
# scripts/recipe/typescript, which `make install-packages` installs from its lock; `typecheck` and `lint-ts` read its declarations. The case results (HYR-7) are the
# files that each language's case runner writes under RECIPE_RESULTS_DIR; a missing file fails the check.
RECIPE_TYPESCRIPT := scripts/recipe/typescript/node_modules
RECIPE_RESULTS_DIR := $(CURDIR)/var/recipe/results

.PHONY: recipe-check recipe-compare recipe-candidates recipe-run-php recipe-run-node recipe-run-python recipe-run-browser recipe-run-build
# Each case runner writes one line per case to the file that RECIPE_RESULTS names (HYR-7); recipe-check runs the five
# runners to their end, then the comparison, which reads their files, and fails when a runner or the comparison fails,
# naming each failed one in its last line (HR-86). Its checks are the commands of the runners and of the comparison,
# which the variables below hold for it and for the targets recipe-run-* and recipe-compare, and not those targets: a
# check that is a make would run in a dry run (HR-83), and the goals of one make -k pass the output of a runner on as
# it is, so a runner that ends without a newline joins the next line (HR-84), and make names a failed goal only where
# it failed and not after the last one. recipe-check therefore has the prerequisites of the five runners, which are
# built before its first check, and its dry run prints one accumulating command and runs none.
# case_run_* start the case runner of a language alone, without a results file; recipe_run_* name the results file of
# a full run, and a selected run of a hyper-test target names its own (cases_selected).
case_run_php = COMPOSER_VENDOR_DIR=$(PHP_VENDOR) node $(KIT)/run-tests.$(KIT_EXT) phpunit --cwd $(PHP_PACKAGE) $(PHPUNIT_EXTENSIONS) -- --filter CaseRunnerTest
case_run_node = node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(NODE_PACKAGE) -- tests/case-runner.test.ts
case_run_python = PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/run-tests.$(KIT_EXT) python --venv $(PYTHON_VENV) -- discover -s $(PYTHON_PACKAGE)/tests -t $(PYTHON_PACKAGE) -p test_case_runner.py
case_run_browser = node $(KIT)/run-tests.$(KIT_EXT) vitest --cwd $(JS_PACKAGE) -- tests/case-runner.test.ts
recipe_run_php = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/php.txt $(case_run_php)
recipe_run_node = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/node.txt $(case_run_node)
recipe_run_python = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/python.txt $(case_run_python)
recipe_run_browser = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/browser.txt $(case_run_browser)
recipe_run_build = RECIPE_RESULTS=$(RECIPE_RESULTS_DIR)/build.txt $(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/scripts/build-id.test.mts
recipe_compare = $(NODE) scripts/recipe/check.mts --root . --php-autoload $(PHP_VENDOR)/autoload.php --results php=$(RECIPE_RESULTS_DIR)/php.txt --results node=$(RECIPE_RESULTS_DIR)/node.txt --results python=$(RECIPE_RESULTS_DIR)/python.txt --results browser=$(RECIPE_RESULTS_DIR)/browser.txt --results build=$(RECIPE_RESULTS_DIR)/build.txt
recipe-run-php: server-fixtures ext hyper-ext ## Run the PHP case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(recipe_run_php)

recipe-run-node: packages node-fixtures ## Run the Node case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(recipe_run_node)

recipe-run-python: server-fixtures ## Run the Python case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(recipe_run_python)

recipe-run-browser: packages ## Run the browser case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(recipe_run_browser)

recipe-run-build: packages ## Run the build case runner with its results file (HYR-7)
	@mkdir -p $(RECIPE_RESULTS_DIR)
	$(recipe_run_build)

recipe-check: server-fixtures ext hyper-ext packages node-fixtures ## Check contracts/interfaces.json against the sources of the three servers and their case results (HYR-7, HYR-8)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'recipe-check needs the pinned TypeScript of scripts/recipe/typescript: run make install-packages'; exit 1; }
	@mkdir -p $(RECIPE_RESULTS_DIR); failed=; \
	$(call check,the PHP case runner,$(recipe_run_php)) \
	$(call check,the Node case runner,$(recipe_run_node)) \
	$(call check,the Python case runner,$(recipe_run_python)) \
	$(call check,the browser case runner,$(recipe_run_browser)) \
	$(call check,the build case runner,$(recipe_run_build)) \
	$(call check,the recipe check,$(recipe_compare)) \
	$(checks_result)

recipe-compare: ## Compare contracts/interfaces.json with the sources of the three servers and the case results that the runners wrote (HYR-7, HYR-8)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'recipe-compare needs the pinned TypeScript of scripts/recipe/typescript: run make install-packages'; exit 1; }
	$(recipe_compare)

recipe-candidates: ## Write the candidate of contracts/interfaces.json under var/recipe, with the hand-written fields listed beside it (HYR-10)
	@test -d $(RECIPE_TYPESCRIPT) || { echo 'recipe-candidates needs the pinned TypeScript of scripts/recipe/typescript: run make install-packages'; exit 1; }
	$(NODE) scripts/recipe/candidate.mts --root . --php-autoload $(PHP_VENDOR)/autoload.php --output var/recipe/interfaces.candidate.json

.PHONY: core-test core-lint core-fmt-check
# The Rust core of the server rules (C-7) at packages/rust, built with the toolchain of its rust-toolchain.toml
# and the lints of its Cargo.toml and clippy.toml (plan R-1).
CORE := packages/rust
# Every cargo command runs through `cargo <dir> <args>` of the link script of kit, which in a development checkout patches
# the polyspec crates to the providers that .links names and otherwise runs cargo as given, so no .cargo file is needed (H35.14-1).
CARGO := $(NODE) $(KIT)/link.$(KIT_EXT) cargo $(CURDIR)
core-test: ## Run the tests of the Rust core, which run the cases of contracts/ that it decides (HY-132)
	$(CARGO) test --locked --offline -p polyspec-hyper
core-lint: ## Run clippy on the Rust core and its tests with every warning an error (plan R-1)
	$(CARGO) clippy --locked --offline -p polyspec-hyper --all-targets -- -D warnings
core-fmt-check: ## Check the format of the Rust core
	$(CARGO) fmt --check -p polyspec-hyper

# Cargo.lock is written by cargo (HR-70): after a change of the tag of a crate in a Cargo.toml, cargo-lock runs
# `cargo update -p <crate>` for the crates of CRATES through $(CARGO), which fetches the tag. In a checkout with a link
# declaration the link script gives cargo its own copy of the lock under var/link/cargo and leaves the tracked lock as
# it is (kit K1269), and it has no mode that writes the tracked lock, so the target fails there before it starts cargo:
# it writes Cargo.lock only in the release state, a checkout without .links, where the link script runs cargo as given.
.PHONY: cargo-lock
cargo-lock: ## Write Cargo.lock for the crates of CRATES with cargo update, in a checkout without .links; ONLINE
	@test -n "$(strip $(CRATES))" || { echo 'cargo-lock: CRATES is empty; name the crates whose pin changed: make cargo-lock CRATES="<crate> <crate>"' >&2; exit 2; }
	@test ! -e $(CURDIR)/.links || { echo 'cargo-lock: $(CURDIR)/.links exists, so the link script of kit would update its copy of the lock under var/link/cargo and leave Cargo.lock as it is (kit K1269); run the target in a checkout without .links' >&2; exit 1; }
	$(ONLINE) $(CARGO) update $(foreach crate,$(CRATES),-p $(crate))

# The bindings of the Rust core for the five targets of packages/rust/interface.json (binding design L-1, L-2, L-2a).
# BINDING is the bin of the npm package @polyspec/binding, which package.json declares by its release asset and
# make install-packages installs from package-lock.json (HR-70, H35.14-2); the Cargo.toml files require
# polyspec-binding-core by the tag of the same release, so the generator and binding_core are one version (G-6, CK-20),
# which binding check compares. bindings writes the generated folders, which Git ignores (native/generated/ of packages/php,
# packages/python and packages/ts, packages/ts/native/wasm/generated, packages/go/internal/ffi/generated), and the
# tracked Go files zz_generated_*.go of packages/go (binding GN-3). bindings-check runs the contract check, which also
# compares the tracked binding packages with what binding scaffold writes (binding L-2, CK-19). bindings-scaffold runs
# binding scaffold, which writes those tracked packages: the Cargo manifest, the entry file and the language manifest of
# each binding, packages/go/go.mod and go.sum among them, after a change of the contract or of a pin that they state.
.PHONY: bindings bindings-check bindings-scaffold lint-bindings test-bindings node-package test-wasm test-go
BINDING := $(CURDIR)/node_modules/@polyspec/binding/dist/cli.js
.PHONY: binding-cases
# The cases of contracts/ that the generated tests of every binding run (HR-100): scripts/binding-cases.mts writes the
# sections of config/binding-cases.json into var/binding-cases, which the rows of cases of the contract name.
binding-cases: ## Write var/binding-cases, the cases of contracts/ in the form of the binding (HR-100)
	$(NODE) scripts/binding-cases.mts --config $(CURDIR)/config/binding-cases.json --contracts $(CURDIR)/contracts --output $(CURDIR)/var/binding-cases > /dev/null
bindings: binding-cases ## Write the generated sources of every binding with the binding generator of package.json (binding L-1)
	@test -f $(BINDING) || { echo "bindings: the binding cli $(BINDING) is missing: run make install-packages"; exit 1; }
	$(NODE) $(BINDING) generate --root $(CURDIR) --cargo "$(CARGO)"
bindings-check: binding-cases ## Check the interface contract and the tracked binding packages with the binding generator of package.json (binding CK-19)
	@test -f $(BINDING) || { echo "bindings-check: the binding cli $(BINDING) is missing: run make install-packages"; exit 1; }
	$(NODE) $(BINDING) check $(CURDIR)/packages/rust/interface.json --cargo "$(CARGO)"
# binding scaffold reads the contracts of the libraries that the contract names through $(CARGO) and, for go.sum, the
# sums that `go mod download` of the Go of the checkout gives for the modules that go.mod requires (binding GN-15f,
# GN-15l), which Go downloads when its module cache does not hold them.
bindings-scaffold: binding-cases ## Write the tracked binding packages, go.mod and go.sum among them, with binding scaffold (binding L-2); ONLINE
	@test -f $(BINDING) || { echo "bindings-scaffold: the binding cli $(BINDING) is missing: run make install-packages"; exit 1; }
	$(ONLINE) $(NODE) $(BINDING) scaffold --root $(CURDIR) --cargo "$(CARGO)"

# The release recipes of the bindings (HR-99, binding GN-19h, CK-94): packages/release.mk, which binding release-recipes
# writes and Git ignores, defines the release targets of the bindings with BINDING_RUN, the command that starts the
# binding generator, and BINDING_DEP, its install target, which is empty, since make install-packages of every checkout
# installs the generator; -include lets a checkout without the file run every other
# target. No rule of this Makefile has a recipe for one of its targets.
# The file also defines LLVM_MAJOR and LLVM_ROOT, which hyper-ext reads. Once make install-packages installed the
# generator, the file has a rule: a make that does not find it writes it with the recipe of release-recipes, which
# renames the whole file into place (HR-82), and then reads the Makefile again with it, also in a dry run, so every
# target, the first make of a fresh checkout included, reads the values of that one source. Before the install the
# rule does not exist and the file stays absent.
.PHONY: release-recipes
BINDING_RUN := $(NODE) $(BINDING)
BINDING_DEP :=
define write-release-recipes
	@test -f $(BINDING) || { echo "release-recipes: the binding cli $(BINDING) is missing: run make install-packages"; exit 1; }
	$(BINDING_RUN) release-recipes --root $(CURDIR) --out $(CURDIR)
endef
release-recipes: ## Write packages/release.mk, the release recipes of the bindings, with binding release-recipes (HR-99)
	$(write-release-recipes)
ifneq ($(wildcard $(BINDING)),)
$(CURDIR)/packages/release.mk:
	$(write-release-recipes)
endif
-include $(CURDIR)/packages/release.mk

# The binding crates of the workspace. The WASM crate is not in the tree (Cargo.toml): its lint and its build name the
# manifest of the place that binding scaffold gives it, and fail while it is missing. The crate of the PHP extension is
# compiled against the headers of the PHP of the checkout, so its clippy and its tests are commands of their own in
# the target directory of the API of that PHP, which they share with the build of hyper-ext ($(PHP_EXT_CARGO)); the
# other crates read no header of PHP and keep $(CARGO_TARGET), where node-addon, node-package and test-go read them.
BINDING_CRATES := polyspec-hyper-python polyspec-hyper-node polyspec-hyper-go
WASM_MANIFEST := packages/ts/native/wasm/Cargo.toml
lint-bindings: bindings ## Run clippy on the binding crates with every warning an error, after make bindings
	$(CARGO) clippy --locked --offline $(foreach crate,$(BINDING_CRATES),-p $(crate)) --all-targets --features panic-test -- -D warnings
	$(PHP_EXT_CARGO) clippy --locked --offline -p polyspec-hyper-php-ext --all-targets --features panic-test -- -D warnings
	$(CARGO) clippy --locked --offline --manifest-path $(WASM_MANIFEST) --target wasm32-unknown-unknown --features panic-test -- -D warnings
test-bindings: lint-bindings test-node-addon test-wasm test-go ## Run the tests of the binding crates and the generated tests of Node, WASM and Go
	$(CARGO) test --locked --offline $(foreach crate,$(BINDING_CRATES),-p $(crate))
	$(PHP_EXT_CARGO) test --locked --offline -p polyspec-hyper-php-ext

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
# The addon of the Node package in a checkout (binding T-2): the generated entry native/generated/index.cjs loads the
# package of the platform or, in a checkout, the file hyper.<platform>.node beside it, so the build of the crate is
# copied there and published with one rename (HR-82).
# The addon is built with every test feature of the crate (NODE_ADDON_FEATURES), which the generated tests of the
# binding call: __panicTest, __armFaults, __threadTest and __thrownCount. A feature compiles its member and changes no
# other member, so the Node server tests and the packed platform package of node-package use the same build.
# The generated tests of the Node binding (binding GN-3c) are a node:test file that imports the generated entry beside
# it, so test-node-addon runs them in the checkout after node-addon, on the test runner of kit; the vitest run of
# packages/ts excludes native/ (vitest.config.mts). test-bindings runs it with the generated tests of WASM and Go.
NODE_ADDON_FEATURES := panic-test,fault-test,thread-test,thrown-count-test
.PHONY: node-addon test-node-addon
test-node-addon: node-addon ## Run the generated tests of the Node binding on node --test against the addon of the checkout
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- $(NODE_PACKAGE)/native/generated/tests/generated.test.mjs
node-addon: bindings ## Build the Node addon of this platform and put it beside the generated entry of the Node package
	$(CARGO) build --locked --offline -p polyspec-hyper-node --features $(NODE_ADDON_FEATURES)
	cp $(CARGO_TARGET)/debug/libpolyspec_hyper_node.$(CDYLIB) $(NODE_PACKAGE)/native/generated/$(NODE_ADDON).next-$$$$ && mv -f $(NODE_PACKAGE)/native/generated/$(NODE_ADDON).next-$$$$ $(NODE_PACKAGE)/native/generated/$(NODE_ADDON)

node-package: bindings packages node-addon ## Build the WASM module and the Node addon, then pack and install the npm package into var/bindings/node
	test "$$($(WASM_BINDGEN) --version)" = "wasm-bindgen $(WASM_BINDGEN_RELEASE)"
	$(CARGO) build --locked --offline --manifest-path $(WASM_MANIFEST) --target wasm32-unknown-unknown --features panic-test
	$(WASM_BINDGEN) --target web --out-dir $(NODE_PACKAGE)/native/wasm/generated --out-name hyper_wasm \
		$(CARGO_TARGET)/wasm32-unknown-unknown/debug/polyspec_hyper_wasm.wasm
	mkdir -p $(BINDINGS_VAR)/node $(BINDINGS_VAR)/node-platform
	cp $(CARGO_TARGET)/debug/libpolyspec_hyper_node.$(CDYLIB) $(BINDINGS_VAR)/node-platform/$(NODE_ADDON)
	$(NODE) -e 'require("fs").writeFileSync("$(BINDINGS_VAR)/node-platform/package.json", JSON.stringify({ name: "@polyspec/hyper-$(NODE_PLATFORM)", version: "$(NODE_VERSION)", os: [process.platform], cpu: [process.arch], main: "$(NODE_ADDON)", files: ["$(NODE_ADDON)"] }, null, 2) + "\n")'
	cd $(BINDINGS_VAR)/node-platform && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	cd $(NODE_PACKAGE) && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	# The dependencies of the package are packed from the root install, which installed them from the lock, since an
	# offline install of the packed package finds no registry for them (@polyspec/hyper-client is in no registry).
	mkdir -p $(BINDINGS_VAR)/node/deps
	for dependency in $$($(NODE) -p 'Object.keys(require("./$(NODE_PACKAGE)/package.json").dependencies ?? {}).join(" ")'); do \
		(cd $(CURDIR)/node_modules/$$dependency && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node/deps) || exit 1; done
	echo '{ "private": true }' > $(BINDINGS_VAR)/node/package.json
	cd $(BINDINGS_VAR)/node && $(NPM) install --no-audit --no-fund --omit=optional ./deps/*.tgz ./polyspec-hyper-$(NODE_VERSION).tgz ./polyspec-hyper-$(NODE_PLATFORM)-$(NODE_VERSION).tgz

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
	$(CARGO) build --locked --offline -p polyspec-hyper-go --features panic-test,codec-test
	test -z "$$(cd packages/go && $(GOFMT) -l .)"
	cd packages/go && $(GO_ENV) $(GO) vet ./...
	cd packages/go && $(GO_ENV) $(GO) test -count=1 -v ./...

.PHONY: spec-docs spec-docs-check
spec-docs: ## Write docs/spec/protocol.md and protocol.ko.md from contracts/protocol.json (H2)
	$(NODE) scripts/spec-docs.mts write
spec-docs-check: ## Check contracts/protocol.json and the protocol documents against their generation (H2)
	$(NODE) scripts/spec-docs.mts check

parity: board ext hyper-ext ## Compare PHP documents, rendered with the template extension, with browser renders of document and region JSON
	node scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json $(PHP_SERVER_ARGUMENTS)

server-parity: node-server board ext hyper-ext ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node $(PHP_SERVER_ARGUMENTS)

server-parity-python: board ext hyper-ext ## Compare the Python server responses with the PHP responses, with the browser comparison of parity (HR-55)
	$(NODE) scripts/check-parity.mts --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --python $(PHP_SERVER_ARGUMENTS)

bundle-size: board ## Print the sizes of the SSR script, the CSR shell, the chunks and the largest template with their gzip limits; a size above its limit is a warning, never a failure
	$(NODE) scripts/check-bundle-size.mts --app $(BOARD) --output $(BOARD)/build/client --limits config/bundle-size.json$(if $(filter true,$(GITHUB_ACTIONS)), --annotations)

e2e: board ext hyper-ext ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run; CASES=<pattern> runs the cases whose title matches
	$(NODE) scripts/run-e2e.mts $(PHP_SERVER_ARGUMENTS) --$(NODE) $(KIT)/run-tests.$(KIT_EXT) playwright -- --config tests/e2e/playwright.config.ts$(if $(CASES), --grep '$(CASES)')

virtiofs-check: ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HR-68); a target of the full suite on Darwin
	$(NODE) $(KIT)/run-tests.$(KIT_EXT) node -- --test-concurrency=1 tests/virtiofs/

serve-demo: board ext hyper-ext ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	$(NODE) scripts/serve-demo.mts --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK) $(PHP_SERVER_ARGUMENTS)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	$(NODE) $(KIT)/holder-lock.$(KIT_EXT) clear $(SERVE_DEMO_LOCK)

bench-server: board ext hyper-ext ## Measure PHP request handling and rendering cost per row count, with the template extension
	php $(foreach library,$(PHP_SERVER_EXTENSIONS),-d extension=$(library)) benchmarks/server.php --app $(BOARD) --iterations 300

bench-browser: board ext hyper-ext ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	$(NODE) benchmarks/browser.mts --runs 15 $(PHP_SERVER_ARGUMENTS)

bench-sessions: packages ## Measure the requests per second of the three servers on one Redis server
	$(NODE) benchmarks/sessions.mts --requests 20000

bench-uploads: packages ext hyper-ext ## Measure the time, the processor time and the memory of an upload in the three servers and in the reader of PHP itself
	$(NODE) benchmarks/uploads.mts --size 1073741824 --runs 3 $(PHP_SERVER_ARGUMENTS)

bench-server-smoke: board ext hyper-ext ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php $(foreach library,$(PHP_SERVER_EXTENSIONS),-d extension=$(library)) benchmarks/server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser bench-uploads ## Run the measurements; results are reports, not pass or fail checks

# The final suite runs through the native kit report runner, which runs every target to its end and refuses nothing.
# Run it once after checklist development on a committed tree, then rerun only failed owners. GATE_TARGETS are the checks of the configuration,
# the layout, the documents, the owners, the parity declarations and the lint, which run the checkers of kit.
GATE_TARGETS := layout-check docs-check owner-validate rebuild-check rules-check language-check duplication-check suppression-check lint-ts lint-php lint-python
CHECK_TARGETS := $(GATE_TARGETS) typecheck bench-server-smoke hyper-lint analyse-php templates-check hyper-test-scripts spec-docs-check recipe-check hyper-test-js hyper-test-node hyper-test-python hyper-test-python-render package-check hyper-test-php parity server-parity server-parity-python bundle-size e2e core-test core-lint core-fmt-check bindings-check test-bindings

# The CI groups of the full suite (HR-91): the matrix of the job check of .github/workflows/ci.yml names CI_GROUPS, and
# each entry runs `make ci-check NAME=<group>` (HR-90). A group declares the tools that install-tools installs (CI_TOOLS),
# its setup steps in their order (CI_SETUP), the symbol extractors of install-symbols (CI_SYMBOLS) and the targets that
# ci-targets runs (CI_TARGETS); the targets of the groups together are every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mts). A group gathers the targets that need the same setup: docs Node.js, PHP, Python
# and Redis for the case runners of recipe-check and the session tests, php PHP and the template build, node Node.js
# and the Rust toolchain that builds the native addon, board also Python and Chromium, python only the Python of its pins. The group bench is the job of bench.yml,
# whose targets are reports and belong to no check (make ci-bench).
CI_GROUPS := gates docs php node board python core
# hyper-install-python builds the native module with maturin of mise.toml and Cargo, so each group that runs it names
# maturin and rust (install-tools of kit selects maturin since K1278).
CI_TOOLS_gates := node php composer pie python uv ruff vulture alint phpcs phpstan rust maturin
CI_SETUP_gates := install-tools hyper-install-crates install-symbols hyper-install-php hyper-install-python
CI_SYMBOLS_gates := php
CI_TARGETS_gates := $(GATE_TARGETS)
CI_TOOLS_docs := node php composer pie python uv rust maturin
CI_SETUP_docs := install-tools hyper-install-crates hyper-install-php hyper-install-python hyper-install-redis hyper-ext
CI_TARGETS_docs := typecheck hyper-test-scripts spec-docs-check recipe-check
CI_TOOLS_php := node php composer pie rust
CI_SETUP_php := install-tools hyper-install-crates hyper-install-php
CI_TARGETS_php := bench-server-smoke hyper-lint analyse-php hyper-test-php
CI_TOOLS_node := node rust
CI_SETUP_node := install-tools hyper-install-crates
CI_TARGETS_node := templates-check hyper-test-js hyper-test-node package-check
CI_TOOLS_board := node php composer pie python uv rust maturin
CI_SETUP_board := install-tools hyper-install-crates hyper-install-php hyper-install-python hyper-install-browser hyper-ext
CI_TARGETS_board := parity server-parity server-parity-python bundle-size e2e
CI_TOOLS_python := node python uv rust maturin
CI_SETUP_python := install-tools hyper-install-crates hyper-install-python
CI_TARGETS_python := hyper-test-python hyper-test-python-render
# The group core checks the Rust core and the bindings of its five targets with the binding generator of package.json (H35.2):
# test-bindings runs lint-bindings, test-node-addon, test-wasm and test-go first, so each runs once. Its tools build the PHP extension, the
# Python module, the WASM module and the static library of Go. The wasm-bindgen CLI of mise.toml, which node-package runs
# for test-wasm, has no selector of install-tools of kit: the setup writes packages/release.mk (release-recipes) and runs
# its target install-wasm-bindgen, which installs that CLI alone with the mise of the checkout at the digest of
# mise.lock. tests/scripts/ci-group-tools.test.mts fails for a group that starts a tool that its setup does not install.
CI_TOOLS_core := node rust php python uv go
CI_SETUP_core := install-tools hyper-install-crates release-recipes install-wasm-bindgen
CI_TARGETS_core := core-test core-lint core-fmt-check bindings-check test-bindings
CI_TOOLS_bench := node php composer pie python uv rust maturin
CI_SETUP_bench := install-tools hyper-install-crates hyper-install-php hyper-install-python hyper-install-redis hyper-install-browser hyper-ext
CI_TARGETS_bench := bench bench-sessions

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
	@$(MAKE) --no-print-directory php-check-installed
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

# ---- CI jobs and reports (HR-90, HR-91, HR-95) -----------------------------------------------------------------------
# Each job of ci.yml and bench.yml runs one recipe, `make ci-check NAME=<group>` or `make ci-bench`, and a local run makes the
# same call. `$(call ci_run,<group>)` runs the setup steps of the group in their order, each a make of its own so it reads
# what the step before installed, and stops at the first failed step: a later step and the targets do not run, because
# they read what the failed step did not install. Then `make ci-targets` runs every target of the group to its end and
# writes the report var/ci/<group>, and `make ci-summary` always writes summary.md and the job summary with the outcome of
# each setup step (CI_STEPS: success, failure or skipped), so a failed setup is named in the report. ci-targets runs
# without GITHUB_STEP_SUMMARY, so the job summary holds the summary once. The status of the run is that of the setup and
# the targets, and a failed write of the summary fails it too, since the job owes its report (HR-91).
# CI_MAKE starts each step, so a dry run (make -n ci-<job>) prints the commands of the job and runs none.
CI_MAKE = $(MAKE) --no-print-directory
ci_step_args = $(if $(filter install-tools,$(2)), TOOLS="$(CI_TOOLS_$(1))")$(if $(filter install-symbols,$(2)), EXTRACTORS="$(CI_SYMBOLS_$(1))")
ci_run = steps=; status=0; \
	$(foreach step,$(CI_SETUP_$(1)),if test $$status -ne 0; then outcome=skipped; elif $(MAKE) --no-print-directory $(step)$(call ci_step_args,$(1),$(step)); then outcome=success; else outcome=failure; status=1; fi; steps="$$steps$${steps:+,}\"$(step)\":{\"outcome\":\"$$outcome\"}";) \
	test $$status -ne 0 || env -u GITHUB_STEP_SUMMARY $(MAKE) --no-print-directory ci-targets TARGETS="$(CI_TARGETS_$(1))" CI_REPORT=var/ci/$(1) || status=1; \
	CI_STEPS="{$$steps}" $(MAKE) --no-print-directory ci-summary CI_REPORT=var/ci/$(1) || status=1; \
	exit $$status

.PHONY: ci-check ci-bench
ci-check: ## Run the CI group NAME as its job of ci.yml does: its setup, its targets to their ends and its report var/ci/NAME; ONLINE
	$(if $(filter $(NAME),$(CI_GROUPS)),,$(error NAME=$(NAME) names no CI group of CI_GROUPS: $(CI_GROUPS)))
	$(call ci_run,$(NAME))

ci-bench: ## Run the job of bench.yml: the setup of the group bench, make bench and make bench-sessions, and the report var/ci/bench; ONLINE
	$(call ci_run,bench)

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
# The job of .github/workflows/release.yml runs make ci-release (HR-90): each step in this order, a make of its own, so the
# steps after release-checkout read the Makefile and the packages of the tagged commit, and the first failure stops the run,
# since each step reads what the step before wrote. release-tag writes TAG and VERSION into var/release/tag.env, the
# GITHUB_ENV of this run, which the recipe reads; when it tagged no version, the run ends with nothing to release. AUTO=1
# follows a workflow_run event (GITHUB_EVENT_NAME), and a dispatch or a local run `make ci-release RUN=<id>` releases the
# commit of RUN. The tools of var/tools are on the PATH of this Makefile, so the recipe needs no release-tools-path.
RELEASE_ENV := var/release/tag.env
RELEASE_STEPS := release-checkout release-php-check bootstrap install-tools install-packages release-archive-tool release-prepare release-tools release-recipes release-assets release-publish release-undraft
.PHONY: ci-release release-php-check
# setup-php sets up the PHP of the .php-version of the checkout before the tag is checked out, and a dispatch checks out main,
# so the release requires the PHP on PATH to be the minor release of the .php-version of the tag before it builds anything.
release-php-check: ## Fail unless the PHP on PATH is the minor release that .php-version of the checkout names, naming both
	@want="$$(tr -d '[:space:]' < .php-version)"; have="$$(php -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;')"; \
	test "$$have" = "$$want" || { echo "release-php-check: the PHP on PATH is $$have, and .php-version of $${TAG:-the checkout} names $$want; set up PHP $$want"; exit 1; }
ci-release: ## Run the job of release.yml: tag the commit of the CI run RUN, then check out, build and publish its release; ONLINE
	@mkdir -p $(dir $(RELEASE_ENV)) && : > $(RELEASE_ENV) && \
	GITHUB_ENV=$(CURDIR)/$(RELEASE_ENV) $(CI_MAKE) release-tag$(if $(filter workflow_run,$(GITHUB_EVENT_NAME)), AUTO=1) && \
	set -a && . ./$(RELEASE_ENV) && set +a && \
	if test -z "$$TAG"; then echo "ci-release: release-tag tagged no version, so nothing is released"; exit 0; fi && \
	$(foreach step,$(RELEASE_STEPS),$(CI_MAKE) $(step)$(if $(filter install-tools,$(step)), TOOLS=npm) &&) true

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
