# The steps of contracts/manifest.json (HY-1, HY-2, HY-37): the manifest files that the manifest check rejects or
# reads, and what a manifest that it read gives.
import json
import re
import tempfile
from pathlib import Path

from polyspec.hyper.page._manifest import Manifest
from polyspec.hyper.app.app import App

from ..case_rules import FAILURES, raises_of


def checks(case) -> None:
    """Writes the manifest file of the case and records whether the manifest check reads it, or the failure of its read."""
    with tempfile.TemporaryDirectory(prefix="hyper-manifest-") as directory:
        file = Path(directory) / "manifest.json"
        stated = [name for name in ("manifest", "text", "bytes") if case.has(name)]
        if len(stated) != 1:
            raise LookupError(
                "the case states not exactly one of manifest, text and bytes"
            )
        content = case.input(stated[0])
        if stated[0] == "manifest":
            file.write_text(json.dumps(content), encoding="utf-8")
        elif stated[0] == "text":
            if not isinstance(content, str):
                raise TypeError("the case field text is not a string")
            file.write_bytes(content.encode("utf-8"))
        else:
            if (
                not isinstance(content, str)
                or re.fullmatch(r"(?:[0-9a-f]{2})*", content) is None
            ):
                raise TypeError("the case field bytes is not hexadecimal digits")
            file.write_bytes(bytes.fromhex(content))
        # The open reads the manifest before the server program, which the step does not give: an open that fails
        # only for the missing program has read the manifest.
        program = str(Path(directory) / "absent")
        try:
            App.open(manifest=str(file), program=program, handlers={}, timezone="Z")
        except FAILURES as failure:
            raises = raises_of(failure)
        else:
            raise LookupError("the application opened without its server program")
    missing = f"of the server program {program} is missing"
    read = missing in raises["message"]
    case.compare("read", True if read else None)
    case.compare("raises", None if read else raises)


def reads(case) -> None:
    """Reads the manifest of the case and compares its regions, its page region, its routes and the kept paths of
    the region that the case names."""
    with tempfile.TemporaryDirectory(prefix="hyper-manifest-") as directory:
        file = Path(directory) / "manifest.json"
        file.write_text(json.dumps(case.input("manifest")), encoding="utf-8")
        manifest = Manifest.from_file(str(file))
    case.compare("regions", [region.name for region in manifest.regions])
    case.compare("page", manifest.page.name)
    case.compare("routes", list(manifest.routes))
    if case.has("region"):
        name = case.input("region")
        region = manifest.region(name)
        if region is None:
            raise LookupError(f"the manifest has no region {name}")
        case.compare("keep", region.keep)
        case.compare("template", region.template)
        if case.has("kinds"):
            case.compare("keptPaths", region.kept_paths(case.input("kinds")))
