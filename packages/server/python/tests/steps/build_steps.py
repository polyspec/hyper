# The steps of contracts/build.json (HY-125): the build id that a `build.json` file gives.
import tempfile
from pathlib import Path

from polyspec.hyper._build import Build
from polyspec.hyper._invalid_build import InvalidBuild


def read(case) -> None:
    with tempfile.TemporaryDirectory(prefix="hyper-build-") as directory:
        file = str(Path(directory) / "build.json")
        text = case.input("text")
        if isinstance(text, str):
            Path(file).write_text(text, encoding="utf-8")
        build = None
        error = None
        try:
            build = Build.read(file)
        except InvalidBuild as failure:
            error = "invalid-build" if file in str(failure) else str(failure)
        case.compare("build", build)
        case.compare("error", error)
