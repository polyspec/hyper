BOARD := examples/board
PHP_PACKAGE := packages/hyper-php
JS_PACKAGE := packages/hyper-js
NODE_PACKAGE := packages/hyper-node
TEMPLATE_DIR := ../template
FIXTURES := $(PHP_PACKAGE)/tests/fixtures
# The native template extension, built from the template repository (HY-48).
EXT := build/ext/release/libpolyspec_template.$(if $(filter Darwin,$(shell uname)),dylib,so)

.DEFAULT_GOAL := help

.PHONY: help install template template-check ext packages package-check server server-fixtures node-server node-fixtures assets test-js test-node test-php lint analyse-php templates-check test-scripts parity server-parity bundle-size e2e docs-check serve-demo bench-server bench-server-smoke bench-browser bench check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## Install npm and Composer dependencies
	npm ci
	composer install --working-dir=$(PHP_PACKAGE)
	composer install --working-dir=$(BOARD)

template: ## Build the TypeScript template package and reinstall the PHP template package copies from the template repository
	cd $(TEMPLATE_DIR) && npm run build -w @polyspec/template
	composer reinstall polyspec/template --no-interaction --working-dir=$(PHP_PACKAGE)
	composer reinstall polyspec/template --no-interaction --working-dir=$(BOARD)

template-check: template ## Fail when a Composer copy of the PHP template package differs from the template repository
	diff -r $(TEMPLATE_DIR)/packages/template-php/src $(PHP_PACKAGE)/vendor/polyspec/template/src
	diff -r $(TEMPLATE_DIR)/packages/template-php/src $(BOARD)/vendor/polyspec/template/src

ext: ## Build the native template extension of the template repository into build/ext
	cargo build --locked --release --manifest-path $(TEMPLATE_DIR)/packages/template-php-ext/Cargo.toml --target-dir build/ext

packages: template ## Build the JavaScript modules and type declarations of the npm packages into their dist directories (HY-61)
	npm run build -w @polyspec/hyper
	npm run build -w @polyspec/hyper-server

package-check: packages node-fixtures ## Install the npm packages into tests/package-install, type-check its test against their declarations and run it under node (HY-61)
	rm -rf tests/package-install/node_modules
	cd tests/package-install && npm install --install-links --no-package-lock --no-audit --no-fund
	npx tsc -p tests/package-install/tsconfig.json
	cd tests/package-install && npm test

server: template ## Build the board server program: its templates and the generated PHP program (HY-48)
	node scripts/build-server.mjs --manifest $(BOARD)/app/app.json --templates $(BOARD)/templates --output $(BOARD)/build/server --template-dir $(TEMPLATE_DIR) --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

server-fixtures: template ## Build the server program of the PHP test fixtures
	node scripts/build-server.mjs --manifest $(FIXTURES)/app.json --templates $(FIXTURES)/templates --output $(PHP_PACKAGE)/tests/build/server --template-dir $(TEMPLATE_DIR) --php-namespace 'Polyspec\Hyper\Tests\Program'

node-server: assets ## Build the board Node server into examples/board/build/node/server.mjs (HY-54)
	npx tsc -p $(BOARD)/node/tsconfig.json
	npx esbuild $(BOARD)/node/main.ts --bundle --platform=node --format=esm --target=node26 --log-level=warning --outfile=$(BOARD)/build/node/server.mjs

node-fixtures: template ## Build the template files of the PHP test fixtures for the Node server tests
	node scripts/build-templates.mjs --templates $(FIXTURES)/templates --output $(NODE_PACKAGE)/tests/build --template-dir $(TEMPLATE_DIR)

assets: packages ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	node scripts/build-assets.mjs --app $(BOARD) --api /api --template-dir $(TEMPLATE_DIR)

test-js: template ## Run the browser code tests, including the router conformance cases, and the type check
	cd $(JS_PACKAGE) && npx vitest run && npx tsc --noEmit -p tsconfig.json

test-node: packages node-fixtures ## Run the Node server tests, including the PHP AppTest cases and the JSON conformance cases, and the type check
	cd $(NODE_PACKAGE) && npx vitest run && npx tsc --noEmit -p tsconfig.json

test-php: template server-fixtures ext ## Run the server package tests with the generated program and with the native extension
	cd $(PHP_PACKAGE) && vendor/bin/phpunit
	cd $(PHP_PACKAGE) && php -d extension=$(abspath $(EXT)) vendor/bin/phpunit

lint: ## Check PHP formatting
	cd $(PHP_PACKAGE) && vendor/bin/pint --test
	cd $(BOARD) && vendor/bin/pint --test app src public

analyse-php: template ## Run PHPStan at level max on the source and the tests of the server package
	cd $(PHP_PACKAGE) && vendor/bin/phpstan analyse --no-progress

templates-check: ## Check hx- attributes (HC-6) and region placements (HY-3, HY-30) of the board templates
	node scripts/check-templates.mjs --app $(BOARD)

test-scripts: ## Run the tests of the check scripts
	TEMPLATE_DIR=$(TEMPLATE_DIR) node --test tests/scripts/

parity: assets server ext ## Compare PHP documents (generated program and native extension) with browser renders of document and region JSON
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --port 8092
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --port 8092 --extension $(EXT)

server-parity: node-server server ## Compare the Node server responses with the PHP responses, with the browser comparison of parity (HY-55)
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --port 8094 --node-port 8096

bundle-size: assets ## Print the SSR script and CSR shell sizes and enforce the gzip limits
	node scripts/check-bundle-size.mjs --app $(BOARD) --limits config/bundle-size.json

e2e: assets server ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium
	rm -f $(BOARD)/var/e2e.db
	npx playwright test

docs-check: ## Check document pairs, links and code blocks
	node scripts/check-documents.mjs

serve-demo: assets server ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare
	node scripts/serve-demo.mjs --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082

bench-server: server ext ## Measure PHP request handling and rendering cost per row count, with the generated program and with the native extension
	php scripts/bench-server.php --app $(BOARD) --iterations 300
	php -d extension=$(abspath $(EXT)) scripts/bench-server.php --app $(BOARD) --iterations 300

bench-browser: assets server ## Measure first screens, navigation, hy-set phases and load, and memory in Chromium
	node scripts/bench-browser.mjs --ssr 8085 --edge 8086 --api 8087 --runs 15

bench-server-smoke: assets server ## Run the PHP benchmark once per measurement so that a change that breaks it fails make check
	php scripts/bench-server.php --app $(BOARD) --iterations 1 > /dev/null

bench: bench-server bench-browser ## Run both measurements; results are reports, not pass or fail checks

check: template-check bench-server-smoke docs-check lint analyse-php templates-check test-scripts test-js test-node package-check test-php parity server-parity bundle-size e2e ## Run every check
