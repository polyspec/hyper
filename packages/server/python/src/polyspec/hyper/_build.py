"""The build id that the server reads when the application opens (HY-125): `build.json` of the program directory
holds exactly the key `build` with 64 lowercase hexadecimal characters. A failure names the file's path; no build id is
invented or defaulted (HY-43 and HY-125)."""

from __future__ import annotations

import json
import re
from pathlib import Path

_BUILD_ID = re.compile(r"[0-9a-f]{64}")


def read_build_id(path: str) -> str:
    """Returns the build id of a `build.json` file, or fails with a ValueError that names the path."""
    file = Path(path)
    try:
        text = file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise ValueError(f"{path} cannot be read as the build id file: {error}") from error
    try:
        value = json.loads(text)
    except ValueError as error:
        raise ValueError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(value, dict) or list(value) != ["build"]:
        raise ValueError(f"{path} does not hold exactly the key build")
    build = value["build"]
    if not isinstance(build, str) or _BUILD_ID.fullmatch(build) is None:
        raise ValueError(f"{path} does not hold a build id of 64 lowercase hexadecimal characters")
    return build
