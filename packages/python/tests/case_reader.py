# The case reader of HYR-7: one case of a case file under contracts/, read through caseFiles of interfaces.json. A runner
# gets its input fields and fixtures from here, and each expected field is compared here, by the comparison of caseFiles.
# The rules that apply to a case are in case_rules.
from __future__ import annotations

from typing import Any

from . import case_rules as rules


class CaseReader:
    def __init__(
        self,
        file: str,
        section: str,
        case: dict,
        data: dict,
        spec: dict,
        failure: str | None,
    ):
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
    def cases(file: str) -> list[CaseReader]:
        """The readers of the cases of a case file that the runner of python runs, in file order."""
        declaration = CaseReader._declaration(file)
        data = rules.contract(file)
        failure = rules.undeclared(declaration, data)
        readers = []
        for name, spec in declaration["sections"].items():
            if rules.LANGUAGE not in spec["runners"]:
                continue
            for case in data.get(name, []):
                if rules.visible(case):
                    readers.append(CaseReader(file, name, case, data, spec, failure))
        return readers

    def section(self) -> str:
        return self._section_name

    def id(self) -> str:
        return self._case["id"]

    def has(self, name: str) -> bool:
        """Whether the case states the dotted field."""
        return rules.lookup(self._case, name)[0]

    def input(self, name: str) -> Any:
        """The input field of the case, or the fixture of the file that the section uses; it counts as read."""
        if name in self._spec["uses"]:
            self._read.add(name)
            return self._data[name]
        node = rules.field(self._spec["fields"], name, self._section_name)
        if node["role"] != "input":
            raise ValueError(f"{name} of {self._section_name} is not an input")
        self._read.add(name)
        for leaf, _ in rules.leaves(node.get("fields", {}), name + "."):
            self._read.add(leaf)
        return rules.lookup(self._case, name)[1]

    def compare(self, name: str, observed: Any) -> None:
        """Compares an observed value with the expected field of the case by its comparison (HYR-11)."""
        node = rules.field(self._spec["fields"], name, self._section_name)
        if not rules.visible(node):
            return
        present, expected = rules.lookup(self._case, name)
        if not present:
            # A field that the declaration does not state as optional is held by every case, as the Node reader
            # requires.
            if node.get("optional") is not True:
                raise ValueError(f"the case has no field {name}")
            return
        self._compared.add(name)
        observed = rules.stated_message(name, expected, observed)
        if name.split(".")[-1] in rules.HEADER_FIELDS:
            expected, observed = rules.folded(expected), rules.folded(observed)
        kind = rules.kind(node, name)
        if kind == "raises":
            try:
                expected = rules.expected_failure(self._spec, expected)
            except ValueError as error:
                self.fail(str(error))
                return
        if not CaseReader._matches(kind, expected, observed):
            self._differs.append(name)

    def outcome(self, name: str, observed: Any) -> None:
        """Compares an outcome: `raises` takes the error that the step caught, or None, and checks its exact class
        (HY-132.7); any other takes the pair."""
        node = self._spec.get("outcomes", {})[name]
        if not rules.visible(node):
            return
        self._compared.add(name)
        if node["compare"] == "raises":
            try:
                expected = rules.expected_failure(self._spec, True)
            except ValueError as error:
                self.fail(str(error))
                return
            ok = CaseReader._matches("raises", expected, observed)
        else:
            ok = CaseReader._matches(node["compare"], observed[0], observed[1])
        if not ok:
            self._differs.append(name)

    def fail(self, reason: str) -> None:
        """Records an error that the step raised, as CASE_ERROR."""
        if self._error is None:
            self._error = "CASE_ERROR " + " ".join(reason.split())

    def line(self) -> str:
        """The result line of the case: the first reason that applies, in the order of HYR-7."""
        head = f"CASE {self._file} {self.id()}"
        names = rules.compared_names(self._spec, self._case)
        if self._failure is not None:
            reason: str | None = self._failure
        elif self._error is not None:
            reason = self._error
        elif not names:
            reason = "CASE_EMPTY"
        elif self._differs:
            reason = f"FIELD_DIFFERS {self._differs[0]}"
        else:
            unknown = rules.unknown_input(self._spec, self._case, self._read)
            uncompared = next(
                (name for name in names if name not in self._compared), None
            )
            if unknown is not None:
                reason = f"FIELD_UNKNOWN {unknown}"
            elif uncompared is not None:
                reason = f"FIELD_UNCOMPARED {uncompared}"
            else:
                reason = None
        return f"{head} PASS" if reason is None else f"{head} FAIL {reason}"

    @staticmethod
    def _declaration(file: str) -> dict:
        files = rules.case_files()
        if file not in files:
            raise KeyError(f"{file} is not a case file of contracts/interfaces.json")
        return files[file]

    @staticmethod
    def _matches(kind: str, expected: Any, observed: Any) -> bool:
        if kind == "exact":
            return CaseReader._equal(expected, observed, False)
        if kind == "ordered":
            return CaseReader._equal(expected, observed, True)
        if kind == "subset":
            seen = {key.lower(): value for key, value in observed.items()}
            return all(
                key.lower() in seen
                and CaseReader._equal(value, seen[key.lower()], False)
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
            return len(observed) >= len(expected) and CaseReader._equal(
                list(expected), head, False
            )
        if kind == "keys":
            return list(observed) == list(expected)
        if kind == "raises":
            # HY-132.7: `expected` is what case_rules.expected_failure gives, None or the exact class and the kind.
            if expected is None:
                return observed is None
            cls, stated = expected
            return type(observed) is cls and (
                stated is None or getattr(observed, "kind", None) == stated
            )
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
            if (
                not (isinstance(a, dict) and isinstance(b, dict))
                or a.keys() != b.keys()
            ):
                return False
            if ordered and list(a) != list(b):
                return False
            return all(CaseReader._equal(a[key], b[key], ordered) for key in a)
        if isinstance(a, (list, tuple)) or isinstance(b, (list, tuple)):
            if not (
                isinstance(a, (list, tuple)) and isinstance(b, (list, tuple))
            ) or len(a) != len(b):
                return False
            return all(
                CaseReader._equal(x, y, ordered) for x, y in zip(a, b, strict=True)
            )
        return a == b
