# The case reader of HYR-7: one case of a case file under contracts/, read through caseFiles of interfaces.json. A runner
# gets its input fields and fixtures from here, and each expected field is compared here, by the comparison of caseFiles.
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# The comparison of each response field, by its name (HYR-11); header names compare without regard to ASCII case (HY-130.20).
RESPONSE_COMPARE = {
    "status": "exact",
    "body": "exact",
    "headers": "subset",
    "allHeaders": "exact",
    "absentHeaders": "absent",
    "bodyContains": "contains",
    "bodyNotContains": "excludes",
}
HEADER_NAMES = {"headers", "allHeaders", "absentHeaders"}


class CaseReader:
    def __init__(self, file: str, section: str, case: dict, data: dict, spec: dict, failure: str | None):
        self._file = file
        self._section_name = section
        self._case = case
        self._data = data
        self._spec = spec
        self._read: set[str] = set()
        self._compared: set[str] = set()
        self._differs: list[str] = []
        self._error: str | None = None
        self._failure = None if failure is None else f"FILE_UNDECLARED {failure}"

    @staticmethod
    def cases(file: str) -> list["CaseReader"]:
        """The readers of the cases of a case file that the runners of python run, in file order."""
        declaration = CaseReader._declaration(file)
        data = CaseReader._json(file)
        failure = CaseReader._undeclared(declaration, data)
        readers = []
        for name, spec in declaration["sections"].items():
            if "python" not in spec["runners"]:
                continue
            for case in data.get(name, []):
                if "only" in case and "python" not in case["only"]["languages"]:
                    continue
                readers.append(CaseReader(file, name, case, data, spec, failure))
        return readers

    @staticmethod
    def _declaration(file: str) -> dict:
        return CaseReader._json("interfaces.json")["caseFiles"][file]

    @staticmethod
    def _json(name: str) -> Any:
        contracts = Path(__file__).resolve().parents[4] / "contracts"
        return json.loads((contracts / name).read_text(encoding="utf-8"))

    @staticmethod
    def _applies(node: dict) -> bool:
        only = node.get("only")
        return only is None or "python" in only["languages"]

    @staticmethod
    def _leaves(fields: dict, prefix: str = ""):
        """The dotted names and the declarations of the fields that carry no fields, for the languages of this reader."""
        for key, node in fields.items():
            if not CaseReader._applies(node):
                continue
            name = prefix + key
            if "fields" in node:
                yield from CaseReader._leaves(node["fields"], name + ".")
            else:
                yield name, node

    @staticmethod
    def _nested_undeclared(node: dict, value: Any, path: str) -> str | None:
        if "fields" not in node or not isinstance(value, dict):
            return None
        for key, item in value.items():
            if key not in node["fields"]:
                return f"{path}.{key}"
            found = CaseReader._nested_undeclared(node["fields"][key], item, f"{path}.{key}")
            if found:
                return found
        return None

    @staticmethod
    def _undeclared(declaration: dict, data: dict) -> str | None:
        """The path of the first key, section or field of a case file that caseFiles does not declare, or None."""
        sections = declaration["sections"]
        for key in data:
            if key not in declaration["fixtures"] and key not in sections:
                return key
        for name, spec in sections.items():
            for index, case in enumerate(data.get(name, [])):
                for key, value in case.items():
                    if key in ("only", "requirements"):
                        continue
                    path = f"{name}[{index}].{key}"
                    if key not in spec["fields"]:
                        return path
                    found = CaseReader._nested_undeclared(spec["fields"][key], value, path)
                    if found:
                        return found
            for field, node in CaseReader._leaves(spec["fields"]):
                if node["role"] == "expected" and not any(k in node for k in ("compare", "sentence")):
                    return f"{name}.{field}"
        return None

    def section(self) -> str:
        return self._section_name

    def id(self) -> str:
        return self._case["id"]

    def _lookup(self, name: str) -> tuple[bool, Any]:
        value: Any = self._case
        for part in name.split("."):
            if not isinstance(value, dict) or part not in value:
                return False, None
            value = value[part]
        return True, value

    def _node(self, name: str) -> dict:
        fields = self._spec["fields"]
        node: dict = {}
        for part in name.split("."):
            fields = node.get("fields", fields) if node else fields
            if part not in fields:
                raise KeyError(f"undeclared field {name}")
            node = fields[part]
        return node

    def has(self, name: str) -> bool:
        return self._lookup(name)[0]

    def input(self, name: str) -> Any:
        if name in self._spec["uses"]:
            self._read.add(name)
            return self._data[name]
        node = self._node(name)
        if node["role"] != "input":
            raise ValueError(f"not an input field: {name}")
        self._read.add(name)
        for leaf, _ in CaseReader._leaves(node.get("fields", {}), name + "."):
            self._read.add(leaf)
        return self._lookup(name)[1]

    def compare(self, name: str, observed: Any) -> None:
        node = self._node(name)
        if not CaseReader._applies(node):
            return
        parts = name.split(".")
        for depth in range(1, len(parts)):
            if not self._lookup(".".join(parts[:depth]))[0]:
                return
        present, expected = self._lookup(name)
        if not present:
            return
        self._compared.add(name)
        kind = RESPONSE_COMPARE[parts[-1]] if node["role"] == "response" else node["compare"]
        if parts[-1] in HEADER_NAMES:
            expected, observed = CaseReader._folded(expected), CaseReader._folded(observed)
        if not CaseReader._matches(kind, expected, observed):
            self._differs.append(name)

    def outcome(self, name: str, observed: Any) -> None:
        node = self._spec.get("outcomes", {})[name]
        if not CaseReader._applies(node):
            return
        self._compared.add(name)
        if node["compare"] == "raises":
            ok = CaseReader._matches("raises", True, observed)
        else:
            ok = CaseReader._matches(node["compare"], observed[0], observed[1])
        if not ok:
            self._differs.append(name)

    def fail(self, reason: str) -> None:
        if self._error is None:
            self._error = f"CASE_ERROR {reason}"

    def line(self) -> str:
        head = f"CASE {self._file} {self.id()}"
        reason = self._reason()
        return f"{head} PASS" if reason is None else f"{head} FAIL {reason}"

    def _reason(self) -> str | None:
        if self._failure is not None:
            return self._failure
        if self._error is not None:
            return self._error
        names = self._compares()
        if not names:
            return "CASE_EMPTY"
        if self._differs:
            return f"FIELD_DIFFERS {self._differs[0]}"
        present_inputs = [
            name
            for name, node in CaseReader._leaves(self._spec["fields"])
            if node["role"] == "input" and self._lookup(name)[0]
        ]
        for name in present_inputs + list(self._spec["uses"]):
            if name not in self._read:
                return f"FIELD_UNKNOWN {name}"
        for name in names:
            if name not in self._compared:
                return f"FIELD_UNCOMPARED {name}"
        return None

    def _compares(self) -> list[str]:
        """The expected and response fields that the case states, then the outcomes of the step that apply to python."""
        names = [
            name
            for name, node in CaseReader._leaves(self._spec["fields"])
            if node["role"] in ("expected", "response") and self._lookup(name)[0]
        ]
        names += [name for name, node in self._spec.get("outcomes", {}).items() if CaseReader._applies(node)]
        return names

    @staticmethod
    def _folded(value: Any) -> Any:
        """The names of a header map, or of a list of header names, in lower case."""
        if isinstance(value, dict):
            return {key.lower(): item for key, item in value.items()}
        if isinstance(value, list):
            return [item.lower() if isinstance(item, str) else item for item in value]
        return value

    @staticmethod
    def _matches(kind: str, expected: Any, observed: Any) -> bool:
        if kind == "exact":
            return CaseReader._equal(expected, observed, False)
        if kind == "ordered":
            return CaseReader._equal(expected, observed, True)
        if kind == "subset":
            seen = {key.lower(): value for key, value in observed.items()}
            return all(
                key.lower() in seen and CaseReader._equal(value, seen[key.lower()], False)
                for key, value in expected.items()
            )
        if kind == "absent":
            names = {key.lower() for key in observed}
            return all(name.lower() not in names for name in expected)
        if kind == "contains":
            items = [expected] if isinstance(expected, str) else expected
            return all(item in observed for item in items)
        if kind == "excludes":
            items = [expected] if isinstance(expected, str) else expected
            return not any(item in observed for item in items)
        if kind == "prefix":
            head = list(observed[: len(expected)])
            return len(observed) >= len(expected) and CaseReader._equal(list(expected), head, False)
        if kind == "keys":
            return list(observed) == list(expected)
        if kind == "raises":
            return type(observed) is ValueError if expected else observed is None
        raise ValueError(f"unknown comparison {kind}")

    @staticmethod
    def _equal(a: Any, b: Any, ordered: bool) -> bool:
        if isinstance(a, bool) or isinstance(b, bool):
            return isinstance(a, bool) and isinstance(b, bool) and a == b
        if a is None or b is None:
            return a is None and b is None
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return a == b
        if isinstance(a, str) or isinstance(b, str):
            return isinstance(a, str) and isinstance(b, str) and a == b
        if isinstance(a, dict) or isinstance(b, dict):
            if not (isinstance(a, dict) and isinstance(b, dict)) or a.keys() != b.keys():
                return False
            if ordered and list(a) != list(b):
                return False
            return all(CaseReader._equal(a[key], b[key], ordered) for key in a)
        if isinstance(a, (list, tuple)) or isinstance(b, (list, tuple)):
            if not (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))) or len(a) != len(b):
                return False
            return all(CaseReader._equal(x, y, ordered) for x, y in zip(a, b))
        return a == b
