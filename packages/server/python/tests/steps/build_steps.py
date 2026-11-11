# The steps of contracts/build.json (HY-125): the build id that a `build.json` file gives.
import re
import tempfile
from pathlib import Path

from polyspec.hyper._build import Build
from polyspec.hyper._invalid_build import InvalidBuild


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
