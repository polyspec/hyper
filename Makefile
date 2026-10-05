BOARD := examples/board
PHP_PACKAGE := packages/hyper-php
JS_PACKAGE := packages/hyper-js
NODE_PACKAGE := packages/hyper-node
# The template repository, read only by `make template`, which writes its declared copy TEMPLATE_DIR (HY-78) of the
# commit at the head of the branch that TEMPLATE_CONFIG names (HY-80). Every other recipe, npm, Composer and the native extension build read the copy.
TEMPLATE_REPOSITORY := ../template
TEMPLATE_CONFIG := config/template.json
TEMPLATE_DIR := var/products/template
# Written after the copy and its npm and Composer installs; the copy is written again only when config/template.json or
# the copy script changes, so one run of many targets copies the template repository at most once.
TEMPLATE_STAMP := $(TEMPLATE_DIR)/installed.stamp
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The native template extension, built from the declared copy of the template repository (HY-48, HY-78).
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
EXT := build/ext/release/libpolyspec_template.$(if $(filter Darwin,$(shell uname)),dylib,so)

# The toolchain (HY-81, scripts/toolchain.mjs): npm and Composer of this checkout, which `make tools` installs into
# var/tools, come first on PATH for every recipe and the programs that it starts. rustup never installs a toolchain on
# the first cargo, because several processes of one run may start cargo at once; `make install` and `make template`
# install the Rust toolchain of the declared copy, and a missing toolchain fails with the message of rustup.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
export RUSTUP_AUTO_INSTALL := 0

# The tracked Git hooks (scripts/git-hooks.mjs). Every make run sets core.hooksPath to this directory when it differs,
# so the pre-push hook refuses a push while a checklist task is in progress (AGENTS.md) in every checkout that ran make.
HOOKS_PATH := .githooks
$(if $(filter $(HOOKS_PATH),$(shell git config core.hooksPath)),,$(shell git config core.hooksPath $(HOOKS_PATH)))

.DEFAULT_GOAL := help

.PHONY: help tools toolchain-check install hyper-php-copy template template-check ext packages package-check server server-fixtures node-server node-fixtures assets test-js test-node test-php lint analyse-php templates-check test-scripts parity server-parity bundle-size e2e docs-check serve-demo bench-server bench-server-smoke bench-browser bench check rerun-failed serve-demo-unlock hooks hooks-check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

tools: ## Install the pinned npm and Composer into var/tools (HY-81)
	node scripts/toolchain.mjs install

toolchain-check: ## Fail when Node.js, npm, Composer, PHP or make differs from its pin, naming the expected and the actual value (HY-81)
	node scripts/toolchain.mjs check $(MAKE_VERSION)

install: tools ## Install the pinned tools, write the declared copy of the template branch and install npm and Composer dependencies and the Rust toolchain from it
	node scripts/toolchain.mjs check $(MAKE_VERSION)
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --config $(TEMPLATE_CONFIG) --output $(TEMPLATE_DIR)
	cd $(TEMPLATE_DIR) && rustup toolchain install --no-self-update
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	npm ci
	composer install --working-dir=$(PHP_PACKAGE)
	composer install --working-dir=$(BOARD)
	touch $(TEMPLATE_STAMP)

template: toolchain-check $(TEMPLATE_STAMP) ## Write the declared copy of the template branch and reinstall the npm and Composer copies of its packages from it, when config/template.json changed (HY-78, HY-80)

$(TEMPLATE_STAMP): $(TEMPLATE_CONFIG) scripts/copy-template.mjs | toolchain-check
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --config $(TEMPLATE_CONFIG) --output $(TEMPLATE_DIR)
	cd $(TEMPLATE_DIR) && rustup toolchain install --no-self-update
	rm -rf node_modules/@polyspec/template
	npm install --no-audit --no-fund
	composer reinstall polyspec/template --no-interaction --working-dir=$(PHP_PACKAGE)
	composer reinstall polyspec/template --no-interaction --working-dir=$(BOARD)
	touch $@

template-check: template ## Fail when an npm or Composer copy of a template package differs from the declared copy
	diff -r $(TEMPLATE_DIR)/packages/template-ts/dist node_modules/@polyspec/template/dist
	diff -r $(TEMPLATE_DIR)/packages/template-php/src $(PHP_PACKAGE)/vendor/polyspec/template/src
	diff -r $(TEMPLATE_DIR)/packages/template-php/src $(BOARD)/vendor/polyspec/template/src

ext: template ## Build the native template extension of the declared copy with its Rust toolchain into build/ext (HY-81)
	cd $(TEMPLATE_DIR)/packages/template-php-ext && cargo build --locked --release --target-dir $(CURDIR)/build/ext

packages: template ## Build the JavaScript modules and type declarations of the npm packages into their dist directories and reinstall their npm copies (HY-61, HY-79)
	rm -rf $(JS_PACKAGE)/dist && cd $(JS_PACKAGE) && npm run --silent build
	rm -rf node_modules/@polyspec/hyper && npm install --no-audit --no-fund
	rm -rf $(NODE_PACKAGE)/dist && cd $(NODE_PACKAGE) && npm run --silent build
	rm -rf node_modules/@polyspec/hyper-server && npm install --no-audit --no-fund

hyper-php-copy: ## Write the copy of packages/hyper-php that the board installs and reinstall it in the board (HY-79)
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	composer reinstall polyspec/hyper --no-interaction --working-dir=$(BOARD)

package-check: packages node-fixtures ## Install the npm packages into tests/package-install, type-check its test against their declarations and run it under node (HY-61)
	rm -rf tests/package-install/node_modules
	cd tests/package-install && npm install --install-links --no-bin-links --no-package-lock --no-audit --no-fund
	$(TSC) -p tests/package-install/tsconfig.json
	node scripts/run-tests.mjs node --cwd tests/package-install -- package-install.test.ts

server: template hyper-php-copy ## Build the board server program: its templates and the generated PHP program (HY-48)
	node scripts/build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --template-dir $(TEMPLATE_DIR) --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

server-fixtures: template ## Build the server program of the PHP test fixtures
	node scripts/build-server.mjs --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --template-dir $(TEMPLATE_DIR) --php-namespace 'Polyspec\Hyper\Tests\Program'

node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	$(TSC) -p $(BOARD)/node/tsconfig.json
	$(ESBUILD) $(BOARD)/node/main.ts --bundle --platform=node --format=esm --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: template ## Build the template files of the PHP test fixtures for the Node server tests
	node scripts/build-templates.mjs --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build --template-dir $(TEMPLATE_DIR)

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	node scripts/build-assets.mjs --app $(BOARD) --api /api --template-dir $(TEMPLATE_DIR) --output $(BOARD)/build
	cp $(BOARD)/public/assets/*.css $(BOARD)/build/csr/assets/

test-js: template ## Run the browser code tests, including the router conformance cases, and the type check
	node scripts/run-tests.mjs vitest --cwd $(JS_PACKAGE)
	$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json

test-node: packages node-fixtures ## Run the Node server tests, including the PHP AppTest cases and the JSON conformance cases, and the type check
	node scripts/run-tests.mjs vitest --cwd $(NODE_PACKAGE)
	$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json

test-php: template server-fixtures ext ## Run the server package tests with the generated program and with the native extension
	node scripts/run-tests.mjs phpunit --cwd $(PHP_PACKAGE)
	node scripts/run-tests.mjs phpunit --cwd $(PHP_PACKAGE) --extension $(EXT)

lint: toolchain-check ## Check PHP formatting
	cd $(PHP_PACKAGE) && vendor/bin/pint --test
	cd $(BOARD) && vendor/bin/pint --test app src public

analyse-php: template ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && vendor/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	node scripts/check-templates.mjs --app $(BOARD)

test-scripts: packages ## Run the tests of the check scripts
	TEMPLATE_DIR=$(TEMPLATE_DIR) node scripts/run-tests.mjs node -- tests/scripts/

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --extension $(EXT)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HY-55)
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node

bundle-size: assets ## Print the SSR script and CSR shell sizes and enforce the gzip limits
	node scripts/check-bundle-size.mjs --app $(BOARD) --output $(BOARD)/build --limits config/bundle-size.json

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run
	node scripts/run-e2e.mjs

docs-check: hooks-check ## Check that the pre-push hook is installed, then document pairs, links and code blocks
	node scripts/check-documents.mjs

hooks: ## Set core.hooksPath to the tracked Git hooks of .githooks and check that the pre-push hook is installed
	git config core.hooksPath $(HOOKS_PATH)
	node scripts/push-gate.mjs hooks-check

hooks-check: ## Fail while the pre-push hook of .githooks is not installed or not executable
	node scripts/push-gate.mjs hooks-check

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	node scripts/serve-demo.mjs --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	node scripts/holder-lock.mjs clear $(SERVE_DEMO_LOCK)

bench-server: server ext ## Measure PHP request handling and rendering cost per row count, with the generated program and with the native extension
	php scripts/bench-server.php --app $(BOARD) --iterations 300
	php -d extension=$(abspath $(EXT)) scripts/bench-server.php --app $(BOARD) --iterations 300

bench-browser: assets server ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	node scripts/bench-browser.mjs --runs 15

bench-server-smoke: assets server ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php scripts/bench-server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser ## Run both measurements; results are reports, not pass or fail checks

# The targets of the full suite. `make check` runs them through the guard scripts/full-run.mjs, which refuses while a
# checklist task is [~], while tracked changes are uncommitted or when var/full-run.json records a run of the current tree,
# runs each target with `make <target>` to its end and records its result; `make rerun-failed` reruns the targets of the
# current tree that did not pass.
CHECK_TARGETS := template-check bench-server-smoke docs-check lint analyse-php templates-check test-scripts test-js test-node package-check test-php parity server-parity bundle-size e2e

check: ## Run every check through the guard: once per tree, when no checklist task is [~]
	node scripts/full-run.mjs run $(CHECK_TARGETS)

rerun-failed: ## Rerun only the targets of make check that did not pass on the current tree
	node scripts/full-run.mjs rerun-failed
