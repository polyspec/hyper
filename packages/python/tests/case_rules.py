# The rules that CaseReader applies to one case of a case file (HYR-7, HYR-11): the declaration checks, the field
# lookups, the unread and uncompared fields, and the folding of header names.
from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

LANGUAGE = "python"
CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
# The fixed case files of tests/legacy, which a library holds now; the steps read them until S-4 removes the directory.
LEGACY = Path(__file__).resolve().parents[3] / "tests" / "legacy"
# The keys of a case that are not fields of its section (HYR-6, HYR-11).
CASE_KEYS = ("id", "label", "only", "requirements")
# HYR-11: the comparison of a response field, by its name.
RESPONSE_KINDS = {
    "status": "exact",
    "body": "exact",
    "headers": "subset",
    "allHeaders": "exact",
    "absentHeaders": "absent",
    "bodyContains": "contains",
    "bodyNotContains": "excludes",
}
# The response fields whose names are header names, which compare without regard to ASCII case (HY-130).
HEADER_FIELDS = frozenset({"headers", "allHeaders", "absentHeaders"})
# The members of contracts/interfaces.json whose Python unit calls the core (HY-132.7): an error that one of them raises
# is of the class of its category of HY-132.2, which the binding generates, and an error of any other member is of the
# base class of its category. A unit that starts to call the core adds its members here in the same change.
CORE_MEMBERS = frozenset(
    {
        "csrf.browserOf",
        "csrf.masked",
        "media-type.etag",
        "record-session.cookieName",
        "reply.cacheControl",
        "reply.referrerPolicy",
        "reply.status",
        "request.currentPath",
        "result.invalid",
        "result.page",
        "result.redirect",
    }
)
# The category of the failure that the comparison `raises` expects: that of the open error of HY-106 (HYR-11).
RAISES_CATEGORY = "value"
# The base class of each category of HY-132.2 in Python.
BASE_CLASSES: dict[str, type[BaseException]] = {
    "value": ValueError,
    "type": TypeError,
    "io": OSError,
    "store": RuntimeError,
    "busy": RuntimeError,
    "internal": RuntimeError,
}
# The class of each category of HY-132.2 by its name in the generated module of the binding.
CORE_CLASS_NAMES = {
    "value": "HyperValueError",
    "type": "HyperTypeError",
    "io": "HyperIoError",
    "store": "HyperStoreError",
    "busy": "HyperBusyError",
    "internal": "HyperInternalError",
}


def contract(name: str) -> Any:
    """The JSON value of a file under contracts/, or of a fixed case file under tests/legacy."""
    folder = LEGACY if name in _legacy_case_files() else CONTRACTS
    return json.loads((folder / name).read_text(encoding="utf-8"))


def _legacy_case_files() -> dict[str, dict]:
    """The `caseFiles` of tests/legacy/interfaces.json, or none when the directory is gone."""
    path = LEGACY / "interfaces.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))["caseFiles"]


def case_files() -> dict[str, dict]:
    """The `caseFiles` of contracts/interfaces.json and of tests/legacy/interfaces.json."""
    return {**contract("interfaces.json")["caseFiles"], **_legacy_case_files()}


def visible(node: dict) -> bool:
    """Whether a field, an outcome or a case applies to this language (HYR-6)."""
    only = node.get("only")
    return only is None or LANGUAGE in only["languages"]


def kind(node: dict, name: str) -> str:
    """The comparison of a field: a response field has the comparison of its name (HYR-11)."""
    if node["role"] == "response":
        return RESPONSE_KINDS[name.split(".")[-1]]
    return node["compare"]


def field(fields: dict, name: str, section: str) -> dict:
    """The declaration of a dotted field name; an undeclared name raises."""
    node: dict = {}
    for part in name.split("."):
        if part not in fields:
            raise KeyError(f"{name} is no declared field of {section}")
        node = fields[part]
        fields = node.get("fields", {})
    return node


def lookup(case: Any, name: str) -> tuple[bool, Any]:
    """Whether the case holds the dotted name, and its value."""
    value = case
    for part in name.split("."):
        if not isinstance(value, dict) or part not in value:
            return False, None
        value = value[part]
    return True, value


def leaves(fields: dict, prefix: str = "") -> Iterator[tuple[str, dict]]:
    """The dotted names and the declarations of the visible fields that carry no fields."""
    for key, node in fields.items():
        if not visible(node):
            continue
        name = prefix + key
        if "fields" in node:
            yield from leaves(node["fields"], name + ".")
        else:
            yield name, node


def unknown_input(section: dict, case: dict, read: set[str]) -> str | None:
    """The first visible input field of the case, or used fixture, that the step has not read."""
    for name, node in leaves(section["fields"]):
        if node["role"] == "input" and lookup(case, name)[0] and name not in read:
            return name
    for name in section["uses"]:
        if name not in read:
            return name
    return None


def compared_names(section: dict, case: dict) -> list[str]:
    """The expected and response fields that the case states, then the visible outcomes of the section."""
    names = [
        name
        for name, node in leaves(section["fields"])
        if node["role"] in ("expected", "response") and lookup(case, name)[0]
    ]
    return names + [
        name for name, node in section.get("outcomes", {}).items() if visible(node)
    ]


def stated_message(name: str, expected: Any, observed: Any) -> Any:
    """The observed failure of a field `raises` without its message when the case states none: a case compares only a
    message that a rule states (HY-132.4). Any other field as observed."""
    if (
        name != "raises"
        or not isinstance(expected, dict)
        or expected.get("message", "stated") is not None
    ):
        return observed
    if not isinstance(observed, dict):
        return observed
    return {**observed, "message": None}


def core_class(category: str) -> type[BaseException]:
    """The class of a category of HY-132.2 that the binding generates. The module is read here, at the first comparison
    of a section of core members, because the package of the binding imports the native module."""
    from polyspec.hyper._binding import _errors

    return getattr(_errors, CORE_CLASS_NAMES[category])


def expected_failure(
    section: dict, expected: Any
) -> tuple[type[BaseException], str | None] | None:
    """What the comparison `raises` expects of a case (HYR-11, HY-132.7): None for no failure, or the exact class of the
    category `value` for the members of the section and the kind that the case states, or None for no kind. The class is
    the generated one when every member of the section calls the core, and the base class when none does or the section
    names no member; a section that names both fails, because one case cannot expect two classes."""
    if expected is False:
        return None
    members = section.get("members", [])
    core = [member for member in members if member in CORE_MEMBERS]
    if core and len(core) != len(members):
        others = [member for member in members if member not in CORE_MEMBERS]
        raise ValueError(
            f"the section names members that call the core ({', '.join(core)}) and members that do not "
            f"({', '.join(others)}) (HY-132.7)"
        )
    category = RAISES_CATEGORY
    cls = core_class(category) if core else BASE_CLASSES[category]
    return cls, expected if isinstance(expected, str) else None


def folded(value: Any) -> Any:
    """The names of a header map, or of a list of header names, in lower case."""
    if isinstance(value, dict):
        return {key.lower(): item for key, item in value.items()}
    if isinstance(value, list):
        return [item.lower() if isinstance(item, str) else item for item in value]
    return value


def _nested_undeclared(node: dict, value: Any, path: str) -> str | None:
    if "fields" not in node or not isinstance(value, dict):
        return None
    for key, item in value.items():
        if key not in node["fields"]:
            return f"{path}.{key}"
        found = _nested_undeclared(node["fields"][key], item, f"{path}.{key}")
        if found:
            return found
    return None


def undeclared(declaration: dict, data: dict) -> str | None:
    """The path of the first key, section or field of a case file that caseFiles does not declare, or None."""
    sections = declaration["sections"]
    for key in data:
        if key not in declaration["fixtures"] and key not in sections:
            return key
    for name, section in sections.items():
        for index, case in enumerate(data.get(name, [])):
            for key, value in case.items():
                if key in CASE_KEYS and key not in section["fields"]:
                    continue
                path = f"{name}[{index}].{key}"
                if key not in section["fields"]:
                    return path
                found = _nested_undeclared(section["fields"][key], value, path)
                if found:
                    return found
        for path, node in leaves(section["fields"]):
            if node["role"] == "expected" and not any(
                k in node for k in ("compare", "sentence")
            ):
                return f"{name}.{path}"
    return None
