# The context of an application (HY-10, HY-124 to HY-128): the cases of contracts/context.json run in steps/context_steps.py,
# which open each application with its build, its context, its shared data and its handlers. This module keeps the helpers
# that open the applications of the contract, and the tests of the builds and of the shared data of an application.
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.not_found import NotFound
from polyspec.hyper.result import Result

ROOT = Path(__file__).resolve().parents[5]
NODE = ROOT / "var" / "tools" / "bin" / "node"
PROGRAMS = ROOT / "var" / "contract-programs"
BUILD_LIBRARY = ROOT / "packages" / "build" / "lib" / "build-id.mjs"


def _contract() -> dict:
    return json.loads((ROOT / "contracts" / "context.json").read_text(encoding="utf-8"))


def program_of(name: str) -> tuple[Path, Path]:
    """Returns the manifest path and the program directory that scripts/contract-programs.mts wrote for an application;
    a missing output fails here and names the missing file."""
    root = PROGRAMS / name
    for path in (root / "manifest.json", root / "build.json", root / "program"):
        if not path.exists():
            raise FileNotFoundError(f"{path} is missing: run make contract-programs")
    return root / "manifest.json", root / "program"


class ContextTest(unittest.TestCase):
    def test_the_builds_have_the_build_ids_of_their_files(self) -> None:
        # HY-125: the build id and the stream of each build are computed by the build function of packages/build.
        builds = _contract()["builds"]
        with tempfile.TemporaryDirectory() as directory:
            computed = build_ids(builds, Path(directory))
        for build, result in zip(builds, computed):
            with self.subTest(build=build["id"]):
                self.assertEqual(build["build"], result["build"])
                if "stream" in build:
                    self.assertEqual(build["stream"], result["stream"])


def build_ids(builds: list, directory: Path) -> list:
    """Returns the build id and the build stream of each build of the contract, computed by the build function
    `buildId` and `buildStream` of packages/build/lib/build-id.mjs with Node, which reads its input from a file."""
    request = directory / "builds.json"
    request.write_text(
        json.dumps(
            [
                {
                    "id": build["id"],
                    "files": [
                        {"path": file["path"], "content": file["content"]}
                        for file in build["files"]
                    ],
                }
                for build in builds
            ]
        ),
        encoding="utf-8",
    )
    script = (
        "import { readFileSync } from 'node:fs';"
        "import { pathToFileURL } from 'node:url';"
        "const [input, library] = process.argv.slice(1);"
        "const { buildId, buildStream } = await import(pathToFileURL(library).href);"
        "const out = JSON.parse(readFileSync(input, 'utf8')).map((build) => {"
        "  const files = build.files.map((file) => ({ path: file.path, bytes: Buffer.from(file.content, 'utf8') }));"
        "  return { id: build.id, build: buildId(files), stream: buildStream(files).toString('hex') };"
        "});"
        "process.stdout.write(JSON.stringify(out));"
    )
    output = directory / "builds.out.json"
    with output.open("w", encoding="utf-8") as stdout:
        status = subprocess.run(
            [
                str(NODE),
                "--input-type=module",
                "-e",
                script,
                str(request),
                str(BUILD_LIBRARY),
            ],
            stdout=stdout,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if status.returncode != 0:
        raise RuntimeError("the build function of packages/build failed")
    return json.loads(output.read_text(encoding="utf-8"))


def _reject(name: str) -> None:
    """Fails for a constant of a JSON text that JSON does not define."""
    raise ValueError(f"the case context holds {name}, which is not JSON")


def open_application(
    application: dict,
    shared: dict | None,
    manifest: Path,
    program: Path,
    calls: list,
    selections: list,
    context: str | None = None,
    failures: list | None = None,
) -> App:
    """Opens the application with the handlers of its contract: a loader stops with NotFound when it says so, an action
    returns the page with its status or the redirect, and the handlers record their calls in order. The shared handler
    returns the shared data of the case, and an application without shared data has no shared handler. The context
    handler returns the decoded JSON text `context`, or the context of the application, as it is, also a value that
    is not a map, so that the server checks it (HY-124); the response hook appends the failure of each response to
    `failures` (HY-60)."""
    loaders = application["loaders"]
    if not isinstance(loaders, dict) or not all(
        isinstance(data, dict) for data in loaders.values()
    ):
        raise ValueError("the loaders are not a map of maps")
    # An absent member declares none; a present member must have its type.
    embed_data = application.get("embedData", [])
    if not isinstance(embed_data, list) or not all(
        isinstance(name, str) for name in embed_data
    ):
        raise ValueError("embedData is not a list of strings")
    embed = set(embed_data)
    actions = application.get("actions", {})
    if not isinstance(actions, dict):
        raise ValueError("the actions are not a map")

    def loader(route: str, data: dict):
        def load(request: Request, reply: Reply) -> dict:
            if route in embed:
                reply.embed_data()
            if "stop" in data:
                if data["stop"] != "NotFound":
                    raise ValueError(
                        f"loader {route} stops with a value other than NotFound"
                    )
                raise NotFound()
            return dict(data)

        return load

    def action(route: str, spec: dict):
        def run(request: Request) -> Result:
            calls.append(f"action:{route}")
            if "redirect" in spec:
                if not isinstance(spec["redirect"], str):
                    raise ValueError(f"the redirect of {route} is not a string")
                return Result.redirect(spec["redirect"])
            # type() and not isinstance(): a bool is an int of Python, but not an integer of JSON.
            if type(spec.get("page")) is not int or not isinstance(
                spec.get("data"), dict
            ):
                raise ValueError(
                    f"the action of {route} has no redirect and no page with data"
                )
            return Result.page(spec["page"], dict(spec["data"]))

        return run

    def shared_data(request: Request) -> dict:
        calls.append("shared")
        return dict(shared)

    routes = {}
    for route in application["manifest"]["routes"]:
        name = route["name"]
        entry: dict = {}
        if name in loaders:
            entry["load"] = loader(name, loaders[name])
        # Only a declared action is registered, as in PHP and Node.
        if name in actions:
            entry["post"] = action(name, actions[name])
        regions = {}
        for region in route.get("regions", []):
            if region["name"] in loaders:
                regions[region["name"]] = loader(
                    region["name"], loaders[region["name"]]
                )
        if regions:
            entry["regions"] = regions
        routes[name] = entry

    text = context if context is not None else application.get("context")
    # NaN and Infinity are not JSON, which PHP and Node refuse; an integer stays an int of Python (HY-44).
    value = None if text is None else json.loads(text, parse_constant=_reject)

    def context_handler(selection: object) -> object:
        calls.append("context")
        selections.append(selection)
        return value

    def on_response(request, response, elapsed, reply, failure) -> None:
        if failures is not None:
            failures.append(failure)

    return App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"routes": routes}
        if shared is None
        else {"shared": shared_data, "routes": routes},
        timezone="+09:00",
        context=context_handler if text is not None else None,
        on_response=on_response,
    )


if __name__ == "__main__":
    unittest.main()
