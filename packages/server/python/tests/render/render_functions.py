# The host functions of an application (HYC-24, HY-106; template FUN-43 to FUN-47 and RT-5): the cases of
# contracts/functions.json run in steps/functions_steps.py, which open the application with the host functions that each
# case names. This module keeps the helpers that open it.
from pathlib import Path

from polyspec.hyper.app import App

ROOT = Path(__file__).resolve().parents[5]
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


def open_application(name: str, application: dict, functions: dict):
    """Opens the application with the host functions of a case and no shared handler; the loader of home returns no
    data."""
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
