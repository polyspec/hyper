# The context of an application (HY-10, HY-124 to HY-128): the cases of contracts/context.json run in steps/context_steps.py,
# which open each application with its build, its context, its shared data and its handlers. This module keeps the helpers
# that open the applications of the contract, and the tests of the builds and of the shared data of an application.
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper._json_codec import decode
from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.result import NotFound, Result

ROOT = Path(__file__).resolve().parents[5]
NODE = ROOT / "var" / "tools" / "bin" / "node"
PROGRAMS = ROOT / "var" / "contract-programs"
BUILD_LIBRARY = ROOT / "packages" / "build" / "lib" / "build-id.mjs"


def _contract() -> dict:
    return json.loads((ROOT / "contracts" / "context.json").read_text(encoding="utf-8"))


def program_of(name: str) -> tuple[Path, Path]:
    """Returns the manifest path and the program directory that scripts/contract-programs.mjs wrote for an application;
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

    def test_the_context_comes_after_the_title_in_the_shared_data(self) -> None:
        # HY-10, HY-73: the shared data keeps title and then context; csrf is not kept by the route, and no value comes
        # before title.
        application = _contract()["applications"]["with_context"]
        manifest, program = program_of("with_context")
        app = open_application(application, {}, manifest, program, [], [])
        kept = app._kept_shared(
            "home",
            {
                "title": "Home",
                "csrf": "token",
                "context": {"title": "Board"},
                "site": "Site",
            },
        )
        self.assertEqual(["title", "context"], list(kept))
        self.assertEqual({"title": "Board"}, kept["context"])


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
            [str(NODE), "--input-type=module", "-e", script, str(request), str(BUILD_LIBRARY)],
            stdout=stdout,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if status.returncode != 0:
        raise RuntimeError("the build function of packages/build failed")
    return json.loads(output.read_text(encoding="utf-8"))


def open_application(
    application: dict,
    shared: dict,
    manifest: Path,
    program: Path,
    calls: list,
    selections: list,
) -> App:
    """Opens the application with the handlers of its contract: a loader stops with NotFound when it says so, an action
    returns the page with its status or the redirect, and the handlers record their calls in order. The shared handler
    returns the shared data of the case."""
    loaders = application["loaders"]
    embed = set(application["embedData"])

    def loader(route: str, data: dict):
        def load(request: Request, reply: Reply) -> dict:
            if route in embed:
                reply.embed_data()
            if "stop" in data:
                raise NotFound()
            return dict(data)

        return load

    def action(route: str, spec: dict):
        def run(request: Request) -> Result:
            calls.append(f"action:{route}")
            if "redirect" in spec:
                return Result.redirect(spec["redirect"])
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
        if route.get("post"):
            entry["post"] = action(name, application["actions"][name])
        regions = {}
        for region in route.get("regions", []):
            if region["name"] in loaders:
                regions[region["name"]] = loader(region["name"], loaders[region["name"]])
        if regions:
            entry["regions"] = regions
        routes[name] = entry

    def context(selection: object) -> dict:
        calls.append("context")
        selections.append(selection)
        return decode(application["context"])

    return App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"shared": shared_data, "routes": routes},
        timezone="+09:00",
        context=context if "context" in application else None,
    )


if __name__ == "__main__":
    unittest.main()
