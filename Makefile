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
# The crate of the native template extension in the declared copy.
EXT_DIR := $(TEMPLATE_DIR)/packages/template-php-ext
EXT := build/ext/release/libpolyspec_template.$(if $(filter Darwin,$(shell uname)),dylib,so)

# The toolchain (HY-81, scripts/toolchain.mjs): npm and Composer of this checkout, which `make tools` installs into
# var/tools, come first on PATH for every recipe and the programs that it starts. rustup never installs a toolchain on
# the first cargo, because several processes of one run may start cargo at once; `make install-rust` installs the Rust
# toolchain of the declared copy, and `make rust-downloads-check` fails with `run make install-rust` while it is missing.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
export RUSTUP_AUTO_INSTALL := 0
# A check reads no network (HY-89): `make install` downloads everything that the checks read, and every other recipe
# and the programs that it starts run cargo, npm and Composer offline, so a missing download fails at once instead of
# reaching a registry in one run and not in another. The downloads of `make tools`, `make install`, `make install-rust`
# and `make install-browser` lift the settings with $(ONLINE).
export CARGO_NET_OFFLINE := true
export npm_config_offline := true
export COMPOSER_DISABLE_NETWORK := 1
ONLINE := env -u CARGO_NET_OFFLINE -u npm_config_offline -u COMPOSER_DISABLE_NETWORK
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

# The GitHub CLI of the machine, authenticated with administration access to the repository; only the targets
# github-ruleset and github-ruleset-check start it (HY-94).
GH := gh

# The tracked Git hooks (scripts/git-hooks.mjs). Every make run sets core.hooksPath to this directory when it differs,
# so the pre-push hook refuses a push while a checklist task is in progress (AGENTS.md) in every checkout that ran make.
HOOKS_PATH := .githooks
$(if $(filter $(HOOKS_PATH),$(shell git config core.hooksPath)),,$(shell git config core.hooksPath $(HOOKS_PATH)))

.DEFAULT_GOAL := help

.PHONY: help tools toolchain-check owner-check install hyper-php-copy template template-check rust-downloads-check install-rust ext packages package-check server server-fixtures node-server node-fixtures assets test-js test-node test-php lint analyse-php templates-check test-scripts virtiofs-check parity server-parity bundle-size e2e docs-check serve-demo bench-server bench-server-smoke bench-browser bench check rerun-failed serve-demo-unlock hooks hooks-check push-gate-commit ci-pins ci-check ci-summary install-browser github-ruleset github-ruleset-check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

tools: ## Install the pinned npm and Composer into var/tools (HY-81)
	$(ONLINE) node scripts/toolchain.mjs install

toolchain-check: ## Fail when Node.js, npm, Composer or the PHP minor differs from its pin, naming the expected and the actual value (HY-81)
	node scripts/toolchain.mjs check

install: tools ## Install the pinned tools, write the declared copy of the template branch and install npm and Composer dependencies from it; make install-rust installs the Rust toolchain of the native extension (HY-89)
	node scripts/toolchain.mjs check
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --config $(TEMPLATE_CONFIG) --output $(TEMPLATE_DIR)
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(NPM) ci --no-audit --no-fund
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install --working-dir=$(PHP_PACKAGE)
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install --working-dir=$(BOARD)
	touch $(TEMPLATE_STAMP)

template: toolchain-check $(TEMPLATE_STAMP) ## Write the declared copy of the template branch and reinstall the npm and Composer copies of its packages from it, when config/template.json changed (HY-78, HY-80)

$(TEMPLATE_STAMP): $(TEMPLATE_CONFIG) scripts/copy-template.mjs | toolchain-check
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --config $(TEMPLATE_CONFIG) --output $(TEMPLATE_DIR)
	node scripts/publish.mjs npm-copy $(TEMPLATE_DIR)/packages/template-ts node_modules/@polyspec/template
	node scripts/publish.mjs composer-copy $(TEMPLATE_DIR)/packages/template-php $(PHP_PACKAGE)/vendor/polyspec/template
	node scripts/publish.mjs composer-copy $(TEMPLATE_DIR)/packages/template-php $(BOARD)/vendor/polyspec/template
	touch $@

template-check: template ## Fail when an npm or Composer copy of a template package differs from the declared copy
	@failed=; \
	$(call check,the npm copy,diff -r $(TEMPLATE_DIR)/packages/template-ts/dist node_modules/@polyspec/template/dist) \
	$(call check,the Composer copy of $(PHP_PACKAGE),diff -r $(TEMPLATE_DIR)/packages/template-php/src $(PHP_PACKAGE)/vendor/polyspec/template/src) \
	$(call check,the Composer copy of $(BOARD),diff -r $(TEMPLATE_DIR)/packages/template-php/src $(BOARD)/vendor/polyspec/template/src) \
	$(checks_result)

# The Rust toolchain and the crates are installed only where `make ext` runs: the targets that build the extension
# (test-php, parity, bench-server) need them, and the CI groups without such a target do not install them (HY-91).
install-rust: template ## Install the Rust toolchain of the declared copy and download the crates of the native extension, after make install (HY-89)
	cd $(TEMPLATE_DIR) && rustup toolchain install --no-self-update
	cd $(EXT_DIR) && $(ONLINE) cargo fetch --locked

# cargo runs offline and answers a missing crate with the advice to retry without --offline, and rustup a missing
# toolchain with `rustup toolchain install`; this check names the fix of a check instead, make install (HY-89).
rust-downloads-check: template ## Fail when the Rust toolchain or a crate of the native extension of the declared copy is missing, naming make install-rust (HY-89)
	node scripts/rust-downloads.mjs $(EXT_DIR)

ext: template rust-downloads-check ## Build the native template extension of the declared copy offline with its Rust toolchain into build/ext (HY-81)
	cd $(EXT_DIR) && cargo build --locked --release --target-dir $(CURDIR)/build/ext

packages: template ## Build the JavaScript modules and type declarations of the npm packages into their dist directories and reinstall their npm copies (HY-61, HY-79)
	cd $(JS_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && node ../../scripts/publish.mjs directory dist.next-$$$$ dist
	node scripts/publish.mjs npm-copy $(JS_PACKAGE) node_modules/@polyspec/hyper
	cd $(NODE_PACKAGE) && $(NPM) run --silent build -- --outDir dist.next-$$$$ && node ../../scripts/publish.mjs directory dist.next-$$$$ dist
	node scripts/publish.mjs npm-copy $(NODE_PACKAGE) node_modules/@polyspec/hyper-server

hyper-php-copy: ## Write the copy of packages/hyper-php that the board installs and reinstall it in the board (HY-79)
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	node scripts/publish.mjs composer-copy $(HYPER_PHP_COPY) $(BOARD)/vendor/polyspec/hyper

package-check: packages node-fixtures ## Install the npm packages into tests/package-install, type-check its test against their declarations and run it under node (HY-61)
	cd tests/package-install && node ../../scripts/holder-lock.mjs run ../../$(INSTALL_LOCK) -- $(NPM) ci --offline --install-links --no-bin-links --no-audit --no-fund
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
	node scripts/build-assets.mjs --app $(BOARD) --api /api --template-dir $(TEMPLATE_DIR) --output $(BOARD)/build --static public/assets/app.css --static public/assets/reader.css

test-js: template ## Run the browser code tests, including the router conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(JS_PACKAGE),node scripts/run-tests.mjs vitest --cwd $(JS_PACKAGE)) \
	$(call check,the type check of $(JS_PACKAGE),$(TSC) --noEmit -p $(JS_PACKAGE)/tsconfig.json) \
	$(checks_result)

test-node: packages node-fixtures ## Run the Node server tests, including the PHP AppTest cases and the JSON conformance cases, and the type check
	@failed=; \
	$(call check,the tests of $(NODE_PACKAGE),node scripts/run-tests.mjs vitest --cwd $(NODE_PACKAGE)) \
	$(call check,the type check of $(NODE_PACKAGE),$(TSC) --noEmit -p $(NODE_PACKAGE)/tsconfig.json) \
	$(checks_result)

test-php: template server-fixtures ext ## Run the server package tests with the generated program and with the native extension
	@failed=; \
	$(call check,PHPUnit with the generated program,node scripts/run-tests.mjs phpunit --cwd $(PHP_PACKAGE)) \
	$(call check,PHPUnit with the native extension,node scripts/run-tests.mjs phpunit --cwd $(PHP_PACKAGE) --extension $(EXT)) \
	$(checks_result)

lint: toolchain-check ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && vendor/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: template ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && vendor/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	node scripts/check-templates.mjs --app $(BOARD)

test-scripts: packages ## Run the tests of the check scripts, or only the files of TESTS
	TEMPLATE_DIR=$(TEMPLATE_DIR) node scripts/run-tests.mjs node -- $(or $(TESTS),tests/scripts/)

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	@failed=; \
	$(call check,parity with the generated program,node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json) \
	$(call check,parity with the native extension,node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --extension $(EXT)) \
	$(checks_result)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HY-55)
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --node

bundle-size: assets ## Print the sizes of the SSR script, the CSR shell and the largest template with their gzip limits; a size above its limit is a warning, never a failure
	node scripts/check-bundle-size.mjs --app $(BOARD) --output $(BOARD)/build --limits config/bundle-size.json

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium on servers of the run
	node scripts/run-e2e.mjs

virtiofs-check: template ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HY-68); a target of the full suite on Darwin
	TEMPLATE_DIR=$(TEMPLATE_DIR) node scripts/run-tests.mjs node -- tests/virtiofs/

docs-check: hooks-check ## Check that the pre-push hook is installed, then document pairs, links and code blocks
	node scripts/check-documents.mjs

hooks: ## Set core.hooksPath to the tracked Git hooks of .githooks and check that the pre-push hook is installed
	git config core.hooksPath $(HOOKS_PATH)
	node scripts/push-gate.mjs hooks-check

push-gate-commit: ## Fail when the commit COMMIT has a checklist task in progress or does not track the pre-push hook as an executable file; the job push-gate of GitHub runs it
	$(if $(COMMIT),,$(error COMMIT names the commit that the push gate checks, such as make push-gate-commit COMMIT=HEAD))
	node scripts/push-gate.mjs commit $(COMMIT)

hooks-check: ## Fail while the pre-push hook of .githooks is not installed or not executable
	node scripts/push-gate.mjs hooks-check

# The GitHub ruleset main and the merge settings of .github/ruleset.json (HY-94, scripts/github-ruleset.mjs): every
# change reaches main through a pull request and the merge queue, which requires the check push-gate and every job of
# the full suite. These targets reach the GitHub API, so no target of the full suite runs them, and none publishes.
github-ruleset: ## Change the merge settings and create or update the GitHub ruleset of .github/ruleset.json where they differ, then compare again (HY-94)
	node scripts/github-ruleset.mjs apply --gh $(GH)

github-ruleset-check: ## Fail when a merge setting or the live GitHub ruleset differs from .github/ruleset.json, naming each field; changes nothing (HY-94)
	node scripts/github-ruleset.mjs check --gh $(GH)

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare; fails with the holder while another demo runs
	node scripts/serve-demo.mjs --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082 --lock $(SERVE_DEMO_LOCK)

serve-demo-unlock: ## Remove the lock of a demo whose process has ended
	node scripts/holder-lock.mjs clear $(SERVE_DEMO_LOCK)

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

# The targets of the full suite. `make check` runs them through the guard scripts/full-run.mjs, which refuses while a
# checklist task is [~], while tracked changes are uncommitted or when var/full-run.json records a run of the current tree,
# runs each target with `make <target>` to its end and records its result; `make rerun-failed` reruns the targets of the
# current tree that did not pass.
CHECK_TARGETS := template-check bench-server-smoke docs-check lint analyse-php templates-check test-scripts test-js test-node package-check test-php parity server-parity bundle-size e2e

# The CI groups of the full suite (HY-91): each job of .github/workflows/ci.yml runs the targets CI_TARGETS_<group> of
# one group with `make ci-check GROUP=<group>`, so the groups together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mjs). A group gathers the targets that need the same setup: docs only Node.js, php
# and node PHP, the template build and the install, board also Chromium.
CI_GROUPS := docs php node board
CI_TARGETS_docs := docs-check
CI_TARGETS_php := template-check bench-server-smoke lint analyse-php test-php
CI_TARGETS_node := templates-check test-scripts test-js test-node package-check
CI_TARGETS_board := parity server-parity bundle-size e2e

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mjs). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

check: ## Run every check through the guard: once per tree, when no checklist task is [~]
	node scripts/full-run.mjs run $(CHECK_TARGETS)

owner-check: ## Run the owner checks of the changed paths (scripts/owner-checks.json): PATHS, the paths since BASE, or the uncommitted changes (HY-88)
	node scripts/owner-check.mjs $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base "$(BASE)")

ci-pins: ## Print the PHP minor of config/toolchain.json and the template branch of config/template.json, and give them to the workflow as step outputs (HY-91)
	node scripts/ci-run.mjs pins

ci-check: ## Run the targets of the CI group GROUP to their ends and write its report var/ci/GROUP; only on GitHub Actions (HY-91)
	$(if $(CI_TARGETS_$(GROUP)),,$(error GROUP names a CI group of CI_GROUPS: $(CI_GROUPS)))
	node scripts/ci-run.mjs run $(GROUP) $(CI_TARGETS_$(GROUP))

ci-summary: ## Write the summary of the CI group GROUP into var/ci/GROUP/summary.md and the job summary of GitHub (HY-91)
	$(if $(filter $(GROUP),$(CI_GROUPS)),,$(error GROUP names a CI group of CI_GROUPS: $(CI_GROUPS)))
	node scripts/ci-run.mjs summary $(GROUP)

install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HY-91)
	$(ONLINE) node node_modules/@playwright/test/cli.js install --with-deps chromium

rerun-failed: ## Rerun only the targets of make check that did not pass on the current tree
	node scripts/full-run.mjs rerun-failed
