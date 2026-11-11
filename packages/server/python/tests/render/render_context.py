# The context of an application, run from contracts/context.json (HY-10, HY-124 to HY-128): every case opens the
# application named by the case with its build, its context, its shared data and its handlers, sends the request and
# compares the response with the stated expectations. The applications are built once by scripts/contract-programs.mjs
# into var/contract-programs, which the tests of the three servers share.
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlencode

from polyspec.hyper._context import hash_of, text_of
from polyspec.hyper._csrf import masked
from polyspec.hyper._json_codec import decode
from polyspec.hyper._session import Session
from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.result import NotFound, Result
from polyspec.hyper.session import ArraySession

ROOT = Path(__file__).resolve().parents[5]
CONTRACT = json.loads((ROOT / "contracts" / "context.json").read_text(encoding="utf-8"))
NODE = ROOT / "var" / "tools" / "bin" / "node"
PROGRAMS = ROOT / "var" / "contract-programs"
BUILD_LIBRARY = ROOT / "packages" / "build" / "lib" / "build-id.mjs"


def program_of(name: str) -> tuple[Path, Path]:
    """Returns the manifest path and the program directory that scripts/contract-programs.mjs wrote for an application;
    a missing output fails here and names the missing file."""
    root = PROGRAMS / name
    for path in (root / "manifest.json", root / "build.json", root / "program"):
        if not path.exists():
            raise FileNotFoundError(f"{path} is missing: run make contract-programs")
    return root / "manifest.json", root / "program"


class ContextTest(unittest.TestCase):
    directory: Path
    programs: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.programs = {name: program_of(name) for name in CONTRACT["applications"]}

    def test_every_context_has_its_text_and_hash(self) -> None:
        for context in CONTRACT["contexts"]:
            with self.subTest(context=context["id"]):
                value = decode(context["context"])
                self.assertEqual(context["context"], text_of(value))
                self.assertEqual(context["hash"], hash_of(context["build"], value))

    def run_case(self, case: dict) -> None:
        application = CONTRACT["applications"][case["application"]]
        manifest, program = self.programs[case["application"]]
        calls: list[str] = []
        selections: list[object] = []
        app = open_application(application, case, manifest, program, calls, selections)
        store = ArraySession()
        headers = dict(case["request"].get("headers", {}))
        fields = dict(case["request"].get("form", {}))
        if case["request"].get("csrf") is True:
            # HY-24: the first response of the session creates its token; the form carries a masked value of it.
            app.handle(Request("GET", "/", {"Accept": "text/html"}), store)
            calls.clear()
            selections.clear()
            fields["_csrf"] = masked(Session(store).csrf_token())
        body = urlencode(fields).encode("utf-8") if fields else b""
        target = case["request"]["target"]
        request = Request(
            case["request"]["method"],
            Request.target_path(target),
            headers,
            Request.target_query(target),
            body,
        )
        # The server writes the cause of a 500 to stderr (HY-43); the case captures it, so that the report of the test
        # holds only its own result.
        logged = io.StringIO()
        with contextlib.redirect_stderr(logged):
            response = app.handle(request, store)
        self.assertEqual(case["status"], response.status)
        if case["status"] == 500:
            self.assertIn(
                "hyper: ValueError: the shared handler returned the key context (HY-124)",
                logged.getvalue(),
            )
        for name, value in case.get("headers", {}).items():
            self.assertEqual(value, response.headers.get(name), name)
        for name in case.get("absentHeaders", []):
            self.assertNotIn(name, response.headers)
        if "body" in case:
            self.assertEqual(case["body"], response.body)
        for text in case.get("bodyContains", []):
            self.assertIn(text, response.body)
        for text in case.get("bodyNotContains", []):
            self.assertNotIn(text, response.body)
        if "keys" in case or "sharedKeys" in case:
            document = json.loads(response.body)
        if "keys" in case:
            self.assertEqual(case["keys"], list(document))
        if "sharedKeys" in case:
            self.assertEqual(case["sharedKeys"], list(document["shared"]))
        if "contextCalls" in case:
            self.assertEqual(case["contextCalls"], calls.count("context"))
        if "firstCalls" in case:
            self.assertEqual(case["firstCalls"], calls[: len(case["firstCalls"])])
        if "selection" in case:
            self.assertEqual([case["selection"]] * calls.count("context"), selections)


    def test_the_builds_have_the_build_ids_of_their_files(self) -> None:
        # HY-125: the build id and the stream of each build are computed by the build function of packages/build.
        builds = CONTRACT["builds"]
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
        manifest, program = self.programs["with_context"]
        app = open_application(
            CONTRACT["applications"]["with_context"],
            {"shared": {}},
            manifest,
            program,
            [],
            [],
        )
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
    case: dict,
    manifest: Path,
    program: Path,
    calls: list,
    selections: list,
) -> App:
    """Opens the application with the handlers of its contract: a loader stops with NotFound when it says so, an action
    returns the page with its status or the redirect, and the handlers record their calls in order."""
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

    def shared(request: Request) -> dict:
        calls.append("shared")
        return dict(case.get("shared", application["shared"]))

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
        handlers={"shared": shared, "routes": routes},
        timezone="+09:00",
        context=context if "context" in application else None,
    )


def _case_test(case: dict):
    def test(self: ContextTest) -> None:
        self.run_case(case)

    return test


for _case in CONTRACT["cases"]:
    setattr(ContextTest, f"test_{_case['id']}", _case_test(_case))


if __name__ == "__main__":
    unittest.main()
