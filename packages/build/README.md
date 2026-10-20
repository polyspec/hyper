<!-- doc-id: hyper-build-readme -->
# @polyspec/hyper-build

[한국어](README.ko.md).

The build commands of the region protocol (HR-96). An application installs the package and runs its two bins from `node_modules/.bin`; the package reads the browser package `@polyspec/hyper-client` and the template packages `@polyspec/template` and `@polyspec/template-compiler` at the exact versions that it requires (HR-70).

Node.js 26.12.0 or later. The package publishes its JavaScript modules as they are, without a build step.

## Server program

`hyper-build-server` checks the templates of the application with the template rules and writes the server program into `--output`: the templates with the reserved template `hyper/data.tpl`, the generated PHP program in the namespace `--php-namespace` as PSR-4 files in the directory `php`, `program.json` and the read paths `reads.json` (HY-48, HY-73). The application maps the namespace to that directory in `autoload.psr-4` of its `composer.json`, through which the PHP server loads the program.

```sh
npx hyper-build-server --manifest app/app.json --templates templates --output build/server --php-namespace 'App\Program'
```

```json
{
    "autoload": {
        "psr-4": {
            "App\\Program\\": "build/server/php/"
        }
    }
}
```

## Browser assets

`hyper-build-assets` builds the application directory `--app`, which holds `app/app.json`, `templates/` and `client/main.ts`: the template files and the client entry with its chunks below `public/assets`, and `templates.index.json`, `manifest.json` and the static shell `csr/` in `--output` (HR-34, HY-76). `--api` is the data base path of the static shell, `--tailwind <source>=<output>` compiles a stylesheet with Tailwind CSS (HR-77), and every `--static` file below `public/` joins the static deployment.

```sh
npx hyper-build-assets --app . --api /api --output build --tailwind styles.css=public/assets/app.css --static public/assets/app.css
```

The procedures are in [Development](../../docs/operations/development.md).
