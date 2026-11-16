"""The error of a `build.json` that does not hold a build id (HY-125)."""

from __future__ import annotations


class InvalidBuild(ValueError):
    """A `build.json` that is missing, is not valid JSON or does not hold exactly the key `build` with a build id of
    64 lowercase hexadecimal characters; the message names the path of the file, and the application does not open
    (HY-125.5)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        # The kind and the status that a failure of the core carries, so that a missing file fails as the other
        # failures of a build file do (HY-125.18, HY-132.1).
        self.kind = "invalid_build"
        self.status = None
