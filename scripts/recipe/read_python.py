"""Reads the Python server sources for the recipe check (HYR-8) and prints one JSON document on stdout.

Usage: python read_python.py <root> --sources <dir>... [--tests <dir>...] [--registry <file>]

The reader uses ``ast`` only; it never imports the modules. Visibility is ``internal`` for a name with a
leading underscore, and for every name of an underscore module; the check maps the spec's ``private`` onto
the underscore name.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
from pathlib import Path

from read_python_scopes import read_registry, read_scopes


def is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def is_private(name: str) -> bool:
    return name.startswith("_") and not is_dunder(name)


def is_class_private(name: str) -> bool:
    """A class-level name with two leading underscores and no trailing ones is private to its class, which Python marks
    by name mangling; such a property is not a member (HYR-8)."""
    return name.startswith("__") and not name.endswith("__")


def import_map(tree: ast.Module) -> dict[str, tuple[str, str]]:
    """The names that the imports of a file bind, each with the module that the import names and its original name:
    `from m import X as Y` binds Y to (m, X), and `import a.b as c` binds c to (a.b, "")."""
    names: dict[str, tuple[str, str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names[alias.asname or alias.name] = (node.module or "", alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname is not None:
                    names[alias.asname] = (alias.name, "")
                else:
                    names[alias.name.split(".")[0]] = (alias.name.split(".")[0], "")
    return names


def last_part(module: str) -> str:
    return module.rsplit(".", 1)[-1]


def imported_call(
    func: ast.expr, imports: dict[str, tuple[str, str]]
) -> tuple[str, str] | None:
    """The last part of the module and the name of a called imported name, or None for a name that no import binds.
    The module of `from . import X` is the package, whose last part is empty; such a name may be a module or a name
    that the package exports."""
    if isinstance(func, ast.Name) and func.id in imports:
        module, name = imports[func.id]
        return (last_part(module), name) if name else None
    if isinstance(func, ast.Attribute):
        parts: list[str] = []
        base: ast.expr = func.value
        while isinstance(base, ast.Attribute):
            parts.insert(0, base.attr)
            base = base.value
        if isinstance(base, ast.Name) and base.id in imports:
            module, name = imports[base.id]
            path = ".".join(part for part in [module, name, *parts] if part)
            return (last_part(path), func.attr)
    return None


def visibility(name: str, module_internal: bool) -> str:
    return "internal" if module_internal or is_private(name) else "public"


def is_static(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(
        isinstance(d, ast.Name) and d.id == "staticmethod" for d in node.decorator_list
    )


def signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    text = f"def {node.name}({ast.unparse(node.args)})"
    if node.returns is not None:
        text += f" -> {ast.unparse(node.returns)}"
    return text


def parameters(
    node: ast.FunctionDef | ast.AsyncFunctionDef, receiver: bool = False
) -> list[str]:
    """The inputs of a function: every parameter in its order, a variadic one included as PHP and Node count it, without
    the first one of a method that is not static, which is the receiver whatever its name."""
    a = node.args
    args = [
        *a.posonlyargs,
        *a.args,
        *([a.vararg] if a.vararg else []),
        *a.kwonlyargs,
        *([a.kwarg] if a.kwarg else []),
    ]
    names = [arg.arg for arg in args]
    return names[1:] if receiver and not is_static(node) and names else names


def is_record(node: ast.ClassDef) -> bool:
    """A class of typing.TypedDict or typing.NamedTuple: a record, whose fields are its annotated names."""
    return any(
        (isinstance(base, ast.Name) and base.id in ("TypedDict", "NamedTuple"))
        or (
            isinstance(base, ast.Attribute) and base.attr in ("TypedDict", "NamedTuple")
        )
        for base in node.bases
    )


def assigned_names(target: ast.expr) -> list[str]:
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        return [name for elt in target.elts for name in assigned_names(elt)]
    if isinstance(target, ast.Starred):
        return assigned_names(target.value)
    return []


def read_module(root: Path, rel: str, out: dict) -> None:
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    stem = Path(rel).stem
    module_internal = stem.startswith("_") and not is_dunder(stem)
    functions = [
        n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]

    if functions:
        out["units"].append(
            {
                "file": rel,
                "name": stem,
                "kind": "functions",
                "internal": module_internal,
            }
        )
        for fn in functions:
            out["members"].append(
                {
                    "file": rel,
                    "unit": stem,
                    "name": fn.name,
                    "kind": "function",
                    "visibility": visibility(fn.name, module_internal),
                    "symbol": f"{rel}::{fn.name}",
                    "signature": signature(fn),
                    "parameters": parameters(fn),
                }
            )

    for cls in classes:
        if is_record(cls):
            fields = [
                m.target.id
                for m in cls.body
                if isinstance(m, ast.AnnAssign) and isinstance(m.target, ast.Name)
            ]
            out["types"].append(
                {
                    "file": rel,
                    "name": cls.name,
                    "visibility": visibility(cls.name, module_internal),
                    "declaration": ast.unparse(cls),
                    "fields": fields,
                }
            )
            continue
        out["units"].append(
            {
                "file": rel,
                "name": cls.name,
                "kind": "class",
                "internal": module_internal,
            }
        )
        for member in cls.body:
            if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                kind = (
                    "constructor"
                    if member.name == "__init__"
                    else "static method"
                    if is_static(member)
                    else "method"
                )
                out["members"].append(
                    {
                        "file": rel,
                        "unit": cls.name,
                        "name": member.name,
                        "kind": kind,
                        "visibility": visibility(member.name, module_internal),
                        "symbol": f"{rel}::{cls.name}.{member.name}",
                        "signature": signature(member),
                        "parameters": parameters(member, receiver=True),
                    }
                )
            elif (
                isinstance(member, ast.AnnAssign)
                and isinstance(member.target, ast.Name)
                and not is_class_private(member.target.id)
            ):
                name = member.target.id
                out["members"].append(
                    {
                        "file": rel,
                        "unit": cls.name,
                        "name": name,
                        "kind": "property",
                        "visibility": visibility(name, module_internal),
                        "symbol": f"{rel}::{cls.name}.{name}",
                        "signature": f"{name}: {ast.unparse(member.annotation)}",
                        "parameters": [],
                    }
                )

    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
        else:
            targets = []
        for name in [n for target in targets for n in assigned_names(target)]:
            if not is_dunder(name):
                out["constants"].append(
                    {
                        "file": rel,
                        "name": name,
                        "visibility": visibility(name, module_internal),
                    }
                )
        if isinstance(node, ast.TypeAlias):
            name = node.name.id
            out["types"].append(
                {
                    "file": rel,
                    "name": name,
                    "visibility": visibility(name, module_internal),
                    "declaration": ast.unparse(node),
                }
            )
        if isinstance(node, ast.ImportFrom) and node.module != "__future__":
            for alias in node.names:
                out["exports"].append({"file": rel, "name": alias.asname or alias.name})

    imports = import_map(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            out["uses"].append({"file": rel, "name": node.attr})
        # HYR-8: a call of an imported name, such as a class that a file constructs, for the check of a private
        # constructor: the original name and the last part of the module that the import names, through an alias
        # and through an attribute of an imported module alike.
        if isinstance(node, ast.Call):
            call = imported_call(node.func, imports)
            if call is not None:
                out["calls"].append({"file": rel, "name": call[1], "module": call[0]})
        if isinstance(node, ast.ImportFrom) and node.module != "__future__":
            for alias in node.names:
                out["uses"] += [
                    {"file": rel, "name": n} for n in (alias.name, alias.asname) if n
                ]
        if isinstance(node, ast.Import):
            for alias in node.names:
                out["uses"] += [
                    {"file": rel, "name": n}
                    for n in [*alias.name.split("."), alias.asname]
                    if n
                ]


# A base of a test class: the test case of unittest, or a class of a file of the test tree.
TEST_CASE = ("", "TestCase")


def test_methods(node: ast.ClassDef) -> list[str]:
    return [
        member.name
        for member in node.body
        if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef))
        and member.name.startswith("test")
    ]


def module_file(rel: str, level: int, module: str, tracked: set[str]) -> str | None:
    """The file of the test tree that a relative import of a file names: the module `module`, `level` packages above the
    file, as a file or as a package; None for a module that is no file of the test tree."""
    parts = rel.split("/")[:-level]
    path = "/".join([*parts, *(module.split(".") if module else [])])
    for candidate in (f"{path}.py", f"{path}/__init__.py"):
        if candidate in tracked:
            return candidate
    return None


def test_bindings(
    rel: str, tree: ast.Module, tracked: set[str]
) -> dict[str, tuple[str, str]]:
    """The names that the relative imports at the top of a test file bind to a file of the test tree: `from .m import
    X as Y` binds Y to (the file of m, X), and `from . import m` binds m to (the file of m, ""), a module."""
    names: dict[str, tuple[str, str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ImportFrom) or node.level == 0:
            continue
        for alias in node.names:
            bound = alias.asname or alias.name
            inner = module_file(
                rel,
                node.level,
                ".".join(part for part in [node.module or "", alias.name] if part),
                tracked,
            )
            if inner is not None:
                names[bound] = (inner, "")
                continue
            outer = module_file(rel, node.level, node.module or "", tracked)
            if outer is not None:
                names[bound] = (outer, alias.name)
    return names


def base_of(
    base: ast.expr,
    rel: str,
    classes: dict[str, ast.ClassDef],
    bindings: dict[str, tuple[str, str]],
) -> tuple[str, str] | None:
    """The class that a base of a class names: a class of the same file, a class that a relative import binds, a class
    of a module that a relative import binds, or the test case of unittest for any other name that ends with
    `TestCase`; None for another base."""
    if isinstance(base, ast.Name):
        if base.id in classes:
            return (rel, base.id)
        if base.id in bindings and bindings[base.id][1] != "":
            return bindings[base.id]
        return TEST_CASE if base.id.endswith("TestCase") else None
    if isinstance(base, ast.Attribute):
        module = base.value
        if (
            isinstance(module, ast.Name)
            and module.id in bindings
            and bindings[module.id][1] == ""
        ):
            return (bindings[module.id][0], base.attr)
        return TEST_CASE if base.attr.endswith("TestCase") else None
    return None


def read_tests(root: Path, rels: list[str], out: dict) -> None:
    """Lists the tests of the files of the test roots (HYR-7): each top-level function whose name starts with `test`,
    and each method whose name starts with `test` of a class that the runner runs. The runner runs a class of a file,
    defined there or imported there by name, whose bases reach the test case of unittest through classes of the test
    tree, with the methods of the class and of each of its bases of the test tree, each method once; and a class
    without such a base whose name starts with `Test`, with the methods of its body."""
    tracked = set(rels)
    trees = {
        rel: ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
        for rel in rels
    }
    classes = {
        rel: {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
        for rel, tree in trees.items()
    }
    bindings = {rel: test_bindings(rel, tree, tracked) for rel, tree in trees.items()}

    def bases(at: tuple[str, str]) -> list[tuple[str, str]]:
        rel, name = at
        node = classes.get(rel, {}).get(name)
        if node is None:
            return []
        found = [base_of(base, rel, classes[rel], bindings[rel]) for base in node.bases]
        return [base for base in found if base is not None]

    def family(at: tuple[str, str]) -> list[tuple[str, str]]:
        """The class and the classes that it extends, the nearer first, each once."""
        seen: list[tuple[str, str]] = []
        waiting = [at]
        while waiting:
            current = waiting.pop(0)
            if current in seen:
                continue
            seen.append(current)
            waiting.extend(bases(current))
        return seen

    def inherited(at: tuple[str, str]) -> list[str] | None:
        """The test methods of a class that the runner runs, or None for a class whose bases do not reach the test
        case of unittest."""
        members = family(at)
        if TEST_CASE not in members:
            return None
        names: list[str] = []
        for rel, name in members:
            node = classes.get(rel, {}).get(name)
            for method in [] if node is None else test_methods(node):
                if method not in names:
                    names.append(method)
        return names

    for rel in rels:
        for node in trees[rel].body:
            if isinstance(
                node, (ast.FunctionDef, ast.AsyncFunctionDef)
            ) and node.name.startswith("test"):
                out["tests"].append({"file": rel, "name": node.name})
            if isinstance(node, ast.ClassDef):
                methods = inherited((rel, node.name))
                if methods is None and node.name.startswith("Test"):
                    methods = test_methods(node)
                for method in methods or []:
                    out["tests"].append({"file": rel, "name": f"{node.name}.{method}"})
        # A class that the file imports by name is a class of the module, which the runner runs there too.
        for file, name in bindings[rel].values():
            if name == "" or name not in classes.get(file, {}):
                continue
            for method in inherited((file, name)) or []:
                out["tests"].append({"file": rel, "name": f"{name}.{method}"})


def files(root: Path, dirs: list[str]) -> list[str]:
    """The Python files git tracks below the directories, relative to the root, sorted."""
    for d in dirs:
        if not (root / d).is_dir():
            raise SystemExit(f"read_python.py: no such directory {d} under {root}")
    listed = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "-z", "--", *dirs],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return sorted(p for p in listed.split("\0") if p.endswith(".py"))


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("root")
    parser.add_argument("--sources", nargs="*", default=[])
    parser.add_argument("--tests", nargs="*", default=[])
    parser.add_argument("--registry")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    sources = files(root, args.sources)
    out: dict = {
        "language": "python",
        "files": sources,
        "units": [],
        "types": [],
        "members": [],
        "constants": [],
        "exports": [],
        "uses": [],
        "calls": [],
        "tests": [],
        "dynamicTests": [],
    }
    for rel in sources:
        read_module(root, rel, out)
    # HYR-7: every Python file under the test roots holds tests.
    tests = files(root, args.tests)
    read_tests(root, tests, out)
    # HYR-5, HYR-7: the scopes of every file of the sources and of the test tree, and the registry of the steps.
    scoped = read_scopes(root, sorted({*sources, *tests}), out)
    out["registry"] = (
        [] if args.registry is None else read_registry(scoped, args.registry)
    )
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
