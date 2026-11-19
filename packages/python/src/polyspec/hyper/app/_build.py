"""The build id of the application, which `build.json` of a server program holds as `{"build":"<id>"}` (HY-125).
The build id is the lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults
it (HY-48)."""

from __future__ import annotations

from pathlib import Path

from ._core_rules import CoreRules
from .._binding._errors import HyperValueError


class Build:
    @staticmethod
    def read(file: str) -> str:
        """Reads the build id of a `build.json` file. The file must exist, be valid JSON and hold exactly the key
        `build` with a build id of 64 lowercase hexadecimal characters; a failure names the path of the file
        (HY-125.5)."""
        try:
            data = Path(file).read_bytes()
        except OSError as error:
            failure = HyperValueError(
                f"{file} is missing or not readable (HY-125)", "invalid_build"
            )
            failure.add_note(f"hyper: the build file is {file}")
            raise failure from error
        # HY-133.2: the core reads the build id of the bytes and fails with invalid_build; the note of the failure
        # names the path of the file (HY-125.5).
        try:
            return CoreRules.shared().build_read(data)
        except ValueError as error:
            error.add_note(f"hyper: the build file is {file}")
            raise
