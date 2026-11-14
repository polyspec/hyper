<!-- doc-id: hyper-cli-readme -->
# @polyspec/hyper-cli

[한국어](README.ko.md).

The command tool `hyper` of the region protocol (HR-96), with the subcommands `hyper build` and `hyper check`. The package takes the rules of the Rust core from the Node binding of the server package `@polyspec/hyper` (its subpath `./native`, HR-61) and reads the template packages `@polyspec/template` and `@polyspec/template-compiler` at the exact versions that it requires (HR-70).

Node.js 26.12.0 or later. The package publishes its JavaScript modules as they are, without a build step. hyper is released as GitHub Release archives only, so an application installs `polyspec-hyper-cli-X.Y.Z.tgz` of the release as a devDependency and runs the bin from a `package.json` script or with `npm exec --package=@polyspec/hyper-cli -- hyper build`. `npx hyper` and `npm exec hyper` without an install run the unrelated public npm package `hyper`, so they are not used.

A caller relies on the bin, its arguments and its exit code: 0 for success, 2 for a usage error, an unknown subcommand or an unknown option, and 1 for a failure. The text of stdout and stderr is no interface.

## Application directory

`--app` names one directory with `app/app.json` (the manifest), `templates/`, an optional `client/main.ts` (the browser entry) and `public/`.

## hyper build

```sh
hyper build --app . --output build --api /api --php-namespace 'App\Program' --tailwind styles.css=app --asset logo=images/logo.svg --static public/favicon.ico
```

One run checks the options, the manifest and the template rules before it writes anything, and computes the build id once over every output (HY-125). It writes (HR-34):

- below `public/assets`, files whose names hold a hash of their content: the template files, the client entry and its chunks, and each asset of `--asset <name>=<path>` and `--tailwind <source>=<name>` (HR-77);
- `<output>/client/`: `manifest.json` with the URL of the entry as `hyper` and the URL of each asset by its name, which the layout code reads; `assets.json` with every path that this build wrote below `public/assets`, for the removal of the files that no build in use names; `templates.index.json` and `build.json`, which the Node server reads; and the static shell `csr/` when `client/main.ts` exists and `--api` is given;
- `<output>/program/`: `templates/`, `reads.json` and `build.json`, which the three servers read, and with `--php-namespace` the generated PHP program `php/` and `program.json` (HY-48).

An asset name matches `[a-z][a-z0-9-]*` and is neither `hyper` nor starts with `hyper-` (HYC-16.13). The build takes no build id. Below `--output` it owns only `client/` and `program/`.

A PHP application maps the namespace to the program in `autoload.psr-4` of its `composer.json`:

```json
{
    "autoload": {
        "psr-4": {
            "App\\Program\\": "build/program/php/"
        }
    }
}
```

## hyper check

```sh
hyper check --app .
```

It checks the manifest (HY-2) and the template rules (HY-48.3), reads no output and writes no file.

The procedures are in [Development](../../docs/operations/development.md).
