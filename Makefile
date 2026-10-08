BOARD := examples/board
PHP_PACKAGE := packages/hyper-php
JS_PACKAGE := packages/hyper-js
NODE_PACKAGE := packages/hyper-node
BUILD_PACKAGE := packages/hyper-build
PYTHON_PACKAGE := packages/hyper-python
# The Python of the checks is the python3 of PATH; requires-python >= 3.11 and the Python pin of
# config/toolchain.json name the release that CI runs.
PYTHON := python3
# npm installs the template packages @polyspec/template and @polyspec/template-compiler and Composer installs
# polyspec/template from the assets of the template release that package.json and composer.json name (HY-70). The
# template repository, read only by `make template`, gives the C sources and the stub of the native extension: its
# declared copy TEMPLATE_DIR (HY-78) of the commit of its tag TEMPLATE_TAG (HY-80), the release of the template
# packages; .github/workflows/ci.yml checks out the same tag. `make ext` and PHPStan read the copy.
TEMPLATE_REPOSITORY := ../template
TEMPLATE_TAG := v0.0.4
TEMPLATE_DIR := var/products/template
# The record of the copy, which the copy script rewrites only when it writes a new copy: when the tag names another
# commit or the copy script changed.
TEMPLATE_COPY := $(TEMPLATE_DIR)/copy.json
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The Composer vendor directory of the private root composer.json, which installs packages/hyper-php for development.
PHP_VENDOR := $(CURDIR)/vendor
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
# The C sources of the native template extension in the declared copy, and the library that `make ext` builds.
EXT_DIR := $(TEMPLATE_DIR)/packages/template-php-ext/src
EXT := build/ext/polyspec_template.so

# The toolchain (HY-81, scripts/toolchain.mjs): npm and Composer of this checkout, which `make tools` installs into
# var/tools, come first on PATH for every recipe and the programs that it starts.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
# A check reads no network (HY-89): `make install` downloads everything that the checks read, and every other recipe
# and the programs that it starts run npm and Composer offline, so a missing download fails at once instead of
# reaching a registry in one run and not in another. The downloads of `make tools`, `make install` and
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

# The GitHub CLI of the machine, authenticated with administration access to the repository; only the targets
# github-ruleset and github-ruleset-check start it (HY-94).
GH := gh

# The tracked Git hooks (scripts/git-hooks.mjs). Every make run sets core.hooksPath to this directory when it differs,
# so the pre-push hook refuses a push while a checklist task is in progress (AGENTS.md) in every checkout that ran make.
HOOKS_PATH := .githooks
$(if $(filter $(HOOKS_PATH),$(shell git config core.hooksPath)),,$(shell git config core.hooksPath $(HOOKS_PATH)))

.DEFAULT_GOAL := help

.PHONY: help tools toolchain-check owner-check install hyper-php-copy template template-tag ext packages package-check server server-fixtures node-server node-fixtures assets test-js test-node test-php test-python lint analyse-php templates-check test-scripts virtiofs-check parity server-parity bundle-size e2e docs-check serve-demo bench-server bench-server-smoke bench-browser bench check rerun-failed serve-demo-unlock hooks hooks-check push-gate-commit ci-pins ci-check ci-summary ci-passed install-browser release-verify release-versions release-assets release-publish release-fixtures github-ruleset github-ruleset-check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

tools: ## Install the pinned npm and Composer into var/tools (HY-81)
	$(ONLINE) node scripts/toolchain.mjs install

toolchain-check: ## Fail when Node.js, npm, Composer or the PHP minor differs from its pin, naming the expected and the actual value (HY-81)
	node scripts/toolchain.mjs check

install: tools ## Install the pinned tools, write the declared copy of the template tag and install the npm and Composer dependencies (HY-89)
	node scripts/toolchain.mjs check
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --tag $(TEMPLATE_TAG) --output $(TEMPLATE_DIR)
	node scripts/copy-package.mjs --path $(PHP_PACKAGE) --output $(HYPER_PHP_COPY)
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(NPM) ci --no-audit --no-fund
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install
	$(ONLINE) node scripts/holder-lock.mjs run $(INSTALL_LOCK) -- $(COMPOSER) install --working-dir=$(BOARD)

# The copy script runs on every make template and leaves TEMPLATE_COPY unchanged while the copy is current.
template: toolchain-check template-tag ## Write the declared copy of the native extension sources of the template tag (HY-78, HY-80)
	node scripts/copy-template.mjs --repository $(TEMPLATE_REPOSITORY) --tag $(TEMPLATE_TAG) --output $(TEMPLATE_DIR)

# A target without a file, so the copy script runs on every make template; it fails when the template checkout has no
# tag TEMPLATE_TAG.
template-tag: ## Fail when the template repository TEMPLATE_REPOSITORY has no tag TEMPLATE_TAG, naming the expected tag and the tags it has (HY-80)
	@git -C $(TEMPLATE_REPOSITORY) rev-parse --verify --quiet 'refs/tags/$(TEMPLATE_TAG)^{commit}' >/dev/null || { \
	  echo "template-tag: $(TEMPLATE_REPOSITORY) has no tag $(TEMPLATE_TAG): expected the tag $(TEMPLATE_TAG), actual tags: $$(git -C $(TEMPLATE_REPOSITORY) tag --list 2>/dev/null | tr '\n' ' ')" >&2; \
	  echo "template-tag: fetch the tags of the template repository with git -C $(TEMPLATE_REPOSITORY) fetch --tags" >&2; \
	  exit 1; }

# The build of the template repository (build-php-extension.mjs of the declared copy) runs phpize, configure and make
# with the php-config of PATH in a temporary directory, builds again only when the sources or the PHP build changed,
# and publishes the library with a rename (HY-82).
ext: template ## Build the native template extension of the declared copy with phpize of the PHP of PATH into build/ext (HY-48, HY-78)
	node $(TEMPLATE_DIR)/scripts/build-php-extension.mjs $(EXT_DIR) $(CURDIR)/$(EXT)

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
	cd tests/package-install && node ../../scripts/holder-lock.mjs run ../../$(INSTALL_LOCK) -- $(NPM) ci --offline --install-links --no-bin-links --allow-remote=root --no-audit --no-fund
	$(TSC) -p tests/package-install/tsconfig.json
	node scripts/run-tests.mjs node --cwd tests/package-install -- package-install.test.ts

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

test-python: ## Run the Python server package tests, which read the conformance cases of routes, rest, csrf, fields and json
	PYTHONPATH=$(CURDIR)/$(PYTHON_PACKAGE)/src $(PYTHON) $(PYTHON_PACKAGE)/tests/run.py

# The rendering tests need the template Python package (H15.3-3): until a template release carries it, they read it
# from the sibling checkout $(TEMPLATE_REPOSITORY), and `make server-fixtures` writes the server program they open.
test-python-render: server-fixtures ## Run the Python rendering tests with the template package of the sibling checkout (H15.3-3)
	PYTHONPATH=$(CURDIR)/$(PYTHON_PACKAGE)/src:$(CURDIR)/$(TEMPLATE_REPOSITORY)/packages/template-python/src $(PYTHON) $(PYTHON_PACKAGE)/tests/run.py $(PYTHON_PACKAGE)/tests/render 'render_*.py'

lint: toolchain-check ## Check PHP formatting
	@failed=; \
	$(call check,Pint of $(PHP_PACKAGE),cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/pint --test) \
	$(call check,Pint of $(BOARD),cd $(BOARD) && vendor/bin/pint --test app src public) \
	$(checks_result)

analyse-php: template ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && $(PHP_VENDOR)/bin/phpstan analyse --no-progress --memory-limit=$(PHPSTAN_MEMORY)

templates-check: toolchain-check ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	node scripts/check-templates.mjs --app $(BOARD)

test-scripts: packages ## Run the tests of the check scripts, or only the files of TESTS
	node scripts/run-tests.mjs node -- $(or $(TESTS),tests/scripts/)

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

virtiofs-check: toolchain-check ## Write the outputs of the server build and of the output copies on a virtiofs bind mount of Apple container (HY-68); a target of the full suite on Darwin
	node scripts/run-tests.mjs node -- tests/virtiofs/

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
# change reaches main through a pull request and the merge queue, which requires the checks push-gate and ci-passed, the
# last job of the full suite. These targets reach the GitHub API, so no target of the full suite runs them, and none publishes.
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
CHECK_TARGETS := bench-server-smoke docs-check lint analyse-php templates-check test-scripts test-js test-node package-check test-php parity server-parity bundle-size e2e

# The CI groups of the full suite (HY-91): each job of .github/workflows/ci.yml runs the targets CI_TARGETS_<group> of
# one group with `make ci-check GROUP=<group>`, so the groups together run every target of CHECK_TARGETS once
# (tests/scripts/ci-workflow.test.mjs). A group gathers the targets that need the same setup: docs only Node.js, php
# and node PHP, the template build and the install, board also Chromium.
CI_GROUPS := docs php node board
CI_TARGETS_docs := docs-check
CI_TARGETS_php := bench-server-smoke lint analyse-php test-php
CI_TARGETS_node := templates-check test-scripts test-js test-node package-check
CI_TARGETS_board := parity server-parity bundle-size e2e

# The targets of the full suite that exist on one platform only. Apple `container`, whose bind mounts are virtiofs,
# exists on Darwin, so `make virtiofs-check` belongs to the full suite there and nowhere else; on Darwin a missing
# `container` fails it (tests/scripts/ci-workflow.test.mjs). The CI groups run CHECK_TARGETS of Linux.
DARWIN_TARGETS := virtiofs-check
CHECK_TARGETS += $(if $(filter Darwin,$(shell uname)),$(DARWIN_TARGETS))

check: ## Run every check through the guard: once per tree, when no checklist task is [~]
	TEMPLATE_REPOSITORY=$(TEMPLATE_REPOSITORY) TEMPLATE_TAG=$(TEMPLATE_TAG) node scripts/full-run.mjs run $(CHECK_TARGETS)

owner-check: ## Run the owner checks of the changed paths (scripts/owner-checks.json): PATHS, the paths since BASE, or the uncommitted changes (HY-88)
	node scripts/owner-check.mjs $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base "$(BASE)")

ci-pins: ## Print the PHP minor of config/toolchain.json and give it to the workflow as a step output (HY-91)
	node scripts/ci-run.mjs pins

ci-check: ## Run the targets of the CI group GROUP to their ends and write its report var/ci/GROUP; only on GitHub Actions (HY-91)
	$(if $(CI_TARGETS_$(GROUP)),,$(error GROUP names a CI group of CI_GROUPS: $(CI_GROUPS)))
	node scripts/ci-run.mjs run $(GROUP) $(CI_TARGETS_$(GROUP))

ci-summary: ## Write the summary of the CI group GROUP into var/ci/GROUP/summary.md and the job summary of GitHub (HY-91)
	$(if $(filter $(GROUP),$(CI_GROUPS)),,$(error GROUP names a CI group of CI_GROUPS: $(CI_GROUPS)))
	node scripts/ci-run.mjs summary $(GROUP)

# make passes a variable of its command line to the environment of the recipe, so the script reads RESULTS there and the
# JSON never becomes shell text.
ci-passed: ## Fail unless every job of RESULTS, the JSON of needs of the job ci-passed of ci.yml, has the result success (HY-94)
	node scripts/ci-run.mjs passed

install-browser: ## Install Chromium of the pinned Playwright and its system libraries; the CI group board runs it (HY-91)
	$(ONLINE) node node_modules/@playwright/test/cli.js install --with-deps chromium

rerun-failed: ## Rerun only the targets of make check that did not pass on the current tree
	TEMPLATE_REPOSITORY=$(TEMPLATE_REPOSITORY) TEMPLATE_TAG=$(TEMPLATE_TAG) node scripts/full-run.mjs rerun-failed

# The steps of .github/workflows/release.yml for the tag TAG (scripts/release.mjs), in this order: release-verify
# requires the tagged commit on origin/main with the checks push-gate and ci-passed passed, release-versions the version
# of the tag in every manifest and its section in CHANGELOG.md, release-assets builds the packages and their archives
# into var/release/assets, and release-publish creates the GitHub Release. The workflow sets TAG in the environment, and
# the recipe passes it as "$$TAG", so the name of a tag never becomes shell text. A step without TAG fails before any
# prerequisite runs.
RELEASE_STEPS := release-verify release-versions release-assets release-publish
$(if $(filter $(RELEASE_STEPS),$(MAKECMDGOALS)),$(if $(TAG),,$(error make $(filter $(RELEASE_STEPS),$(MAKECMDGOALS)) needs TAG=<tag>, a tag vX.Y.Z)))

release-verify: ## Fail unless the commit of the tag TAG is on origin/main and passed the checks push-gate and ci-passed
release-versions: ## Fail unless every manifest declares the version of the tag TAG and CHANGELOG.md has its section
# The locks of the consumer fixtures of tests/release-install (scripts/release-fixtures.mjs, HY-95): npm and Composer
# resolve the fixtures against the assets of the tree and the public registry, so the target runs through $(ONLINE);
# the release commit runs it when a release version changes.
release-fixtures: packages ## Write the locks of the consumer fixtures of tests/release-install from the assets of the tree
	$(ONLINE) node scripts/release-fixtures.mjs

release-assets: packages ## Build the packages and the archive of each into var/release/assets for the tag TAG
release-publish: ## Create the GitHub Release of the tag TAG with its changelog section and the archives
$(RELEASE_STEPS):
	node scripts/release.mjs $(@:release-%=%) "$$TAG"
