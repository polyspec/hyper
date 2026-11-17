# The rules that CaseReader applies to one case of a case file (HYR-7, HYR-11): the declaration checks, the field
# lookups, the unread and uncompared fields, and the folding of header names.
from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

LANGUAGE = "python"
ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts"
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


def contract(name: str) -> Any:
    """The JSON value of a file under contracts/, of a fixed case file under tests/legacy, or of a case file that a
    release of another library publishes (`release` of its caseFiles entry, H35.11)."""
    if name in _legacy_case_files():
        path = LEGACY / name
    else:
        path = _release_file(name) or CONTRACTS / name
    return json.loads(path.read_text(encoding="utf-8"))


def _release_file(name: str) -> Path | None:
    """The installed case file of a release, var/release-files/<library>/<tag>/contracts/<name> from the tag of
    config/release-files.json, or None for a case file of this repository. A missing file fails with its path and the
    target that writes it; the reader downloads nothing (HR-81, HR-85)."""
    if name == "interfaces.json":
        return None
    entry = contract("interfaces.json")["caseFiles"].get(name, {})
    library = entry.get("release")
    if library is None:
        return None
    pins = json.loads((ROOT / "config" / "release-files.json").read_text(encoding="utf-8"))
    tag = pins["releases"][library]["tag"]
    path = ROOT / "var" / "release-files" / library / tag / "contracts" / name
    if not path.exists():
        raise FileNotFoundError(
            f"{path.relative_to(ROOT)} is missing; `make hyper-install-release-files` writes it"
        )
    return path


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


# The base classes of the categories of HY-132.2, which a step catches around the call of a case; raises_of raises an
# error of these classes that is no error of hyper again.
FAILURES = (ValueError, TypeError, OSError, RuntimeError)
_CATEGORY_CLASS = re.compile(r"Hyper([A-Z][a-z]+)Error")


def raises_of(error: BaseException) -> dict:
    """The failure of HY-132 that an error gives, as a field `raises` states it: its kind, its status, the category
    that the first class `Hyper<Category>Error` of its classes names (HY-132.2), and its message. An error without such a
    class is no error of hyper but an error of the step, which is raised again so that it fails the case."""
    category = next(
        (
            match.group(1).lower()
            for match in (
                _CATEGORY_CLASS.fullmatch(cls.__name__) for cls in type(error).__mro__
            )
            if match is not None
        ),
        None,
    )
    if category is None:
        raise error
    return {
        "kind": getattr(error, "kind", None),
        "status": getattr(error, "status", None),
        "category": category,
        "message": str(error),
    }


def open_error(observed: BaseException | None) -> bool:
    """HYR-11: the error that a step raises is the open error when it is the hyper class of the category `value` with
    the kind `invalid_application` (HY-106.21). An error that is no error of hyper is raised again by raises_of."""
    if observed is None:
        return False
    raises = raises_of(observed)
    return raises["category"] == "value" and raises["kind"] == "invalid_application"


def outcome_error(sentence: str | None, observed: BaseException | None) -> bool:
    """HYR-11: whether a step raised the error that a `raises` outcome expects, by the statement that the outcome cites.
    A statement to which the kind tables of HY-132 give kinds, such as HY-106.21 with `invalid_application` and
    `invalid_build` or HY-42.7 with `invalid_text`, accepts an error of one of them (stated_kinds); the creation of a
    server fails with an error of hyper whose kind HY-97.7 does not state, so that only its class is checked until
    H35.29-6; a statement that the tables do not name is an open failure and expects the open error (HY-106.21)."""
    kinds = stated_kinds(sentence) if isinstance(sentence, str) else []
    if not kinds and sentence != "HY-97.7":
        return open_error(observed)
    if observed is None:
        return False
    raises = raises_of(observed)
    return sentence == "HY-97.7" or raises["kind"] in kinds


def _rule_of(value: Any, rule_id: str) -> dict[str, Any] | None:
    """The rule of contracts/protocol.json with an id under a value, or None."""
    children: list[Any] = []
    if isinstance(value, dict):
        if value.get("kind") == "rule" and value.get("id") == rule_id:
            return value
        children = list(value.values())
    elif isinstance(value, list):
        children = value
    for child in children:
        found = _rule_of(child, rule_id)
        if found is not None:
            return found
    return None


def _cell_text(cell: Any) -> str:
    """The English text of a cell of a table of contracts/protocol.json."""
    if not isinstance(cell, dict) or not isinstance(cell.get("en"), str):
        raise LookupError(
            f"a cell of the kind tables of HY-132 has no English text: {cell!r}"
        )
    return cell["en"]


def _kinds_by_statement() -> dict[str, list[str]]:
    """The kinds that each statement states, by its id, from the kind tables of HY-132 (HY-132.3, HY-132.9): the first
    cell of a row is the kind in backticks, and its last cell the ids of the statements that state it, separated by
    ", "."""
    rule = _rule_of(contract("protocol.json"), "HY-132") or {}
    tables = [
        block
        for block in rule.get("blocks", [])
        if isinstance(block, dict) and block.get("kind") == "table"
    ]
    if not tables:
        raise LookupError("contracts/protocol.json holds no kind table of HY-132")
    table: dict[str, list[str]] = {}
    for block in tables:
        for row in block.get("rows", []):
            if not isinstance(row, list) or len(row) < 2:
                raise LookupError(
                    f"a row of the kind tables of HY-132 has no kind and rule: {row!r}"
                )
            kind = _cell_text(row[0]).replace("`", "")
            for statement in _cell_text(row[-1]).split(", "):
                table.setdefault(statement, []).append(kind)
    return table


_KINDS: dict[str, list[str]] = {}


def stated_kinds(sentence: str) -> list[str]:
    """The kinds that the kind tables of HY-132 give to a statement, in their order; none for a statement they do not
    name."""
    if not _KINDS:
        _KINDS.update(_kinds_by_statement())
    return _KINDS.get(sentence, [])


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
