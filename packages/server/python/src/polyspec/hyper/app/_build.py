"""The build id of the application, which `build.json` of a server program holds as `{"build":"<id>"}` (HY-125).
The build id is the lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults
it (HY-48)."""

from __future__ import annotations

import re
from pathlib import Path

from ._invalid_build import InvalidBuild
from ..data._json_codec import JsonCodec
from ..data._json_decode_error import JsonDecodeError


class Build:
    @staticmethod
    def read(file: str) -> str:
        """Reads the build id of a `build.json` file. The file must exist, be valid JSON and hold exactly the key
        `build` with a build id of 64 lowercase hexadecimal characters; a failure names the path of the file
        (HY-125.5)."""
        try:
            data = Path(file).read_bytes()
        except OSError as error:
            raise InvalidBuild(f"{file} is missing or not readable (HY-125)") from error
        try:
            # Bytes that are not UTF-8 and a leading U+FEFF are not valid JSON (HY-106.7); the JSON text is decoded by
            # the decoder of the server, with its one nesting limit (HY-54).
            value = JsonCodec.decode(data.decode("utf-8"))
        except (UnicodeDecodeError, JsonDecodeError) as error:
            raise InvalidBuild(f"{file} is not valid JSON (HY-125)") from error
        build = (
            value.get("build")
            if isinstance(value, dict) and list(value) == ["build"]
            else None
        )
        if not isinstance(build, str) or re.fullmatch(r"[0-9a-f]{64}", build) is None:
            raise InvalidBuild(
                f"{file} does not hold exactly the key build with a build id of 64 lowercase"
                " hexadecimal characters (HY-125)"
            )
        return build
