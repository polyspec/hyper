# Dependencies

[한국어](dependencies.ko.md).

Every dependency uses the latest stable release that supports the declared runtime range: Node.js 26 and PHP 8.2. An exact pin records its reason and the condition that removes it.

| Dependency | Version | Kind | Reason | Removal condition |
|---|---|---|---|---|
| `htmx.org` | `4.0.0` exact | runtime, bundled into the client script | The region protocol uses htmx 4 hooks, request context fields and swap behavior that were verified against the 4.0.0 source. npm tags 4.0.0 as `next` and keeps 2.x as `latest`, so an unpinned range would select htmx 2. | npm tags an htmx 4 release as `latest`; then use a `^4` range and rerun `make check`. |
| `@playwright/test`, `@types/node`, `esbuild`, `typescript`, `vitest` | exact | development | The workspace pins exact development tool versions so that `npm ci` installs the same tools. | Update to each latest stable release and rerun `make check`. |
| `laravel/pint` | `^1.0`, resolves to 1.30.4 | development | Pint 1.31 and later require PHP 8.3; the Composer platform is PHP 8.2. | The supported PHP range starts at 8.3. |
| `phpunit/phpunit` | `^11.5` | development | PHPUnit 12 and later require PHP 8.3. | The supported PHP range starts at 8.3. |
| `@polyspec/hyper` in `@polyspec/hyper-server` | `0.0.1` exact | runtime | The Node server renders with the browser package of the same workspace, so it requires that exact version. | The packages are published and released together under one version range. |
| `@polyspec/template`, `polyspec/template` | local path | runtime | The template packages are used from `../template` because they are not published. Composer copies `polyspec/template` (`symlink: false`) because installing a linked package sets the executable bit on its `bin` file and modifies the template repository. After a change in the template PHP package, run `composer reinstall polyspec/template` in both Composer projects; `composer update` keeps an existing copy of a path package with an unchanged reference. | The template packages are published to npm and Packagist. |
| `docker.io/library/node:26.8.1-trixie-slim` | digest `sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146` | test | `tests/scripts/output-files.test.mjs` runs the build copies with the Node version of the workspace in a Linux container of Apple `container`, whose bind mounts are virtiofs (HY-68). The digest fixes the image that the test ran with. | Node 26.8.1 is no longer the declared Node version; then pin the image of the new version. |
