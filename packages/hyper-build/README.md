# @polyspec/hyper-build

[한국어](README.ko.md).

The build commands of the region protocol (HY-96). An application installs the package and runs its two bins from `node_modules/.bin`; the package reads the browser package `@polyspec/hyper` and the template packages `@polyspec/template` and `@polyspec/template-compiler` at the exact versions that it requires (HY-70).

Node.js 26 or later. The package publishes its JavaScript modules as they are, without a build step.

## Server program

`hyper-build-server` checks the templates of the application with the template rules and writes the server program into `--output`: the templates with the reserved template `hyper/data.tpl`, the generated PHP program `program.php` in the namespace `--php-namespace`, `program.json` and the read paths `reads.json` (HY-48, HY-73).

```sh
npx hyper-build-server --manifest app/app.json --templates templates --output build/server --php-namespace 'App\Program'
```

## Browser assets

`hyper-build-assets` builds the application directory `--app`, which holds `app/app.json`, `templates/` and `client/main.ts`: the template files and the client entry with its chunks below `public/assets`, and `templates.index.json`, `manifest.json` and the static shell `csr/` in `--output` (HY-34, HY-76). `--api` is the data base path of the static shell, `--tailwind <source>=<output>` compiles a stylesheet with Tailwind CSS (HY-77), and every `--static` file below `public/` joins the static deployment.

```sh
npx hyper-build-assets --app . --api /api --output build --tailwind styles.css=public/assets/app.css --static public/assets/app.css
```

The procedures are in [Development](../../docs/operations/development.md).
