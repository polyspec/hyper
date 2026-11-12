# The steps of contracts/build.json (HY-48, HY-125): the build id that a `build.json` file gives, and the open of a
# server program that misses outputs.
import re
import tempfile
from pathlib import Path

from polyspec.hyper.server._build import Build
from polyspec.hyper.server._invalid_build import InvalidBuild
from polyspec.hyper.server._renderer import Renderer

# The outputs of a server program in the order in which the step creates them, and whether each is a directory.
_OUTPUTS = {
    "php": True,
    "program.json": False,
    "reads.json": False,
    "build.json": False,
    "templates": True,
}


def read(case) -> None:
    with tempfile.TemporaryDirectory(prefix="hyper-build-") as directory:
        file = str(Path(directory) / "build.json")
        # A None `text` is a missing file, unless `bytes` gives the bytes of the file as hexadecimal digits.
        text = case.input("text")
        if isinstance(text, str):
            Path(file).write_text(text, encoding="utf-8")
        elif text is not None:
            raise TypeError("the case field text is neither a string nor null")
        elif case.has("bytes"):
            data = case.input("bytes")
            if (
                not isinstance(data, str)
                or re.fullmatch(r"(?:[0-9a-f]{2})*", data) is None
            ):
                raise TypeError("the case field bytes is not hexadecimal digits")
            Path(file).write_bytes(bytes.fromhex(data))
        build = None
        error = None
        message = None
        try:
            build = Build.read(file)
        except InvalidBuild as failure:
            error = "invalid-build" if file in str(failure) else str(failure)
            message = str(failure)
        case.compare("build", build)
        case.compare("error", error)
        case.compare("message", message)


def outputs(case) -> None:
    """Creates a program directory without the outputs that the case names, opens it and compares the error and its
    message, in which `{program}` stands for the path of the program directory."""
    missing = case.input("missing")
    for name in missing:
        if name not in _OUTPUTS:
            raise ValueError(f"the case misses the unknown output {name!r}")
    with tempfile.TemporaryDirectory(prefix="hyper-build-") as directory:
        program = Path(directory) / "program"
        program.mkdir()
        for name, is_directory in _OUTPUTS.items():
            if name in missing:
                continue
            if is_directory:
                (program / name).mkdir()
            else:
                (program / name).write_bytes(b"")
        error = None
        try:
            Renderer.open(str(program), "Z")
        except Exception as failure:  # noqa: BLE001 - the reader checks the class of the error
            error = failure
    case.outcome("open", error)
    case.compare(
        "message",
        "" if error is None else str(error).replace(str(program), "{program}"),
    )
