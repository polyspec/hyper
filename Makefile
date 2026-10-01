BOARD := examples/board
PHP_PACKAGE := packages/hyper-php
JS_PACKAGE := packages/hyper-js
TEMPLATE_DIR := ../template

.DEFAULT_GOAL := help

.PHONY: help install template assets test-js test-php lint templates-check parity bundle-size e2e docs-check serve-demo check

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## Install npm and Composer dependencies
	npm ci
	composer install --working-dir=$(PHP_PACKAGE)
	composer install --working-dir=$(BOARD)

template: ## Build the TypeScript template package that the browser bundle imports
	cd $(TEMPLATE_DIR) && npm run build -w @polyspec/template

assets: ## Build the board client bundle (SSR) and the single-file static shell (CSR)
	node scripts/build-assets.mjs --app $(BOARD) --api /api

test-js: ## Run the browser code tests, including the router conformance cases, and the type check
	cd $(JS_PACKAGE) && npx vitest run && npx tsc --noEmit -p tsconfig.json

test-php: ## Run the server package tests, including the router conformance cases
	cd $(PHP_PACKAGE) && vendor/bin/phpunit

lint: ## Check PHP formatting
	cd $(PHP_PACKAGE) && vendor/bin/pint --test
	cd $(BOARD) && vendor/bin/pint --test app src public

templates-check: ## Check that only the layout template carries hx- attributes (HC-6)
	node scripts/check-templates.mjs --app $(BOARD)

parity: assets ## Compare PHP documents with browser renders of document and region JSON
	node scripts/check-parity.mjs --app $(BOARD) --requests $(BOARD)/tests/parity/requests.json --port 8092

bundle-size: assets ## Print the SSR script and CSR shell sizes and enforce the gzip limits
	node scripts/check-bundle-size.mjs --app $(BOARD) --limits config/bundle-size.json

e2e: assets ## Run the SSR, CSR, no-JavaScript and comparison flows in Chromium
	rm -f $(BOARD)/var/e2e.db
	npx playwright test

docs-check: ## Check document pairs, links and code blocks
	node scripts/check-documents.mjs

serve-demo: assets ## Serve SSR on :8080, CSR on :8081 and the comparison page on :8081/compare
	node scripts/serve-demo.mjs --db $(BOARD)/var/board.db --ssr 8080 --edge 8081 --api 8082

check: docs-check lint templates-check test-js test-php parity bundle-size e2e ## Run every check
