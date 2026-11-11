# The host functions of an application (HYC-24, HY-106; template FUN-43 to FUN-47 and RT-5): every case of
# contracts/functions.json opens the application with_functions of var/contract-programs with the host functions that the
# case names, then checks the open or the response that the case states.
import contextlib
import io
import json
import unittest
from pathlib import Path

from polyspec.hyper.app import App
from polyspec.hyper.request import Request
from polyspec.hyper.session import ArraySession

ROOT = Path(__file__).resolve().parents[5]
CONTRACT = json.loads((ROOT / "contracts" / "functions.json").read_text(encoding="utf-8"))
PROGRAMS = ROOT / "var" / "contract-programs"


def function_of(kind: str):
    """Maps a kind of the contract to a value of the runtime: `suffix` is a function, `not_a_function` is the string."""
    if kind == "suffix":
        # HostFunction receives the argument list and the function context (FUN-43).
        return lambda args, context: args[0] + "!"
    if kind == "not_a_function":
        return "x"
    raise KeyError(f"unknown function kind {kind!r}")


def program_of(name: str) -> tuple[Path, Path]:
    """Returns the manifest path and the program directory that scripts/contract-programs.mjs wrote for an application."""
    root = PROGRAMS / name
    for path in (root / "manifest.json", root / "build.json", root / "program"):
        if not path.exists():
            raise FileNotFoundError(f"{path} is missing: run make contract-programs")
    return root / "manifest.json", root / "program"


def open_application(name: str, functions: dict):
    """Opens the application with the host functions of a case and no shared handler; the loader of home returns no
    data."""
    application = CONTRACT["applications"][name]
    manifest, program = program_of(name)
    routes = {
        route["name"]: {"load": lambda request, reply: {}}
        for route in application["manifest"]["routes"]
    }
    return App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"shared": None, "routes": routes},
        timezone="+09:00",
        functions=functions,
    )


class FunctionsTest(unittest.TestCase):
    def run_case(self, case: dict) -> None:
        functions = {name: function_of(kind) for name, kind in case["functions"].items()}
        if case.get("openFails"):
            with self.assertRaises(ValueError) as raised:
                open_application(case["application"], functions)
            if "openError" in case:
                self.assertIn(case["openError"], str(raised.exception))
            return
        app = open_application(case["application"], functions)
        store = ArraySession()
        spec = case["request"]
        # The server writes the cause of a 500 to stderr (HY-43); the case captures it, so that the report of the test
        # holds only its own result.
        logged = io.StringIO()
        with contextlib.redirect_stderr(logged):
            response = app.handle(
                Request(spec["method"], Request.target_path(spec["target"]), dict(spec["headers"])),
                store,
            )
        self.assertEqual(case["status"], response.status)
        if "body" in case:
            self.assertEqual(case["body"], response.body)
        for text in case.get("bodyContains", []):
            self.assertIn(text, response.body)


def _case_test(case: dict):
    def test(self: FunctionsTest) -> None:
        self.run_case(case)

    return test


for _case in CONTRACT["cases"]:
    setattr(FunctionsTest, f"test_{_case['id']}", _case_test(_case))


if __name__ == "__main__":
    unittest.main()
