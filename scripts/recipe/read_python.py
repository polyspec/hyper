"""Reads the Python server sources for the recipe check (HYR-8) and prints one JSON document on stdout.

Usage: python read_python.py <root> --sources <dir>... [--tests <dir>...]

The reader uses ``ast`` only; it never imports the modules. Visibility is ``internal`` for a name with a
leading underscore, and for every name of an underscore module; the check maps the spec's ``private`` onto
the underscore name.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


def is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def is_private(name: str) -> bool:
    return name.startswith("_") and not is_dunder(name)


def visibility(name: str, module_internal: bool) -> str:
    return "internal" if module_internal or is_private(name) else "public"


def is_static(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(isinstance(d, ast.Name) and d.id == "staticmethod" for d in node.decorator_list)


def signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    text = f"def {node.name}({ast.unparse(node.args)})"
    if node.returns is not None:
        text += f" -> {ast.unparse(node.returns)}"
    return text


def parameters(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
    return [a.arg for a in args if a.arg not in ("self", "cls")]


def is_test_class(node: ast.ClassDef) -> bool:
    for base in node.bases:
        name = base.id if isinstance(base, ast.Name) else base.attr if isinstance(base, ast.Attribute) else ""
        if name.endswith("TestCase"):
            return True
    return False


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
    functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]

    if functions:
        out["units"].append({"file": rel, "name": stem, "kind": "functions", "internal": module_internal})
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
        out["units"].append({"file": rel, "name": cls.name, "kind": "class", "internal": module_internal})
        for member in cls.body:
            if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                kind = "constructor" if member.name == "__init__" else "static method" if is_static(member) else "method"
                out["members"].append(
                    {
                        "file": rel,
                        "unit": cls.name,
                        "name": member.name,
                        "kind": kind,
                        "visibility": visibility(member.name, module_internal),
                        "symbol": f"{rel}::{cls.name}.{member.name}",
                        "signature": signature(member),
                        "parameters": parameters(member),
                    }
                )
            elif isinstance(member, ast.AnnAssign) and isinstance(member.target, ast.Name):
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
                out["constants"].append({"file": rel, "name": name, "visibility": visibility(name, module_internal)})
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

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            out["uses"].append({"file": rel, "name": node.attr})
        if isinstance(node, ast.ImportFrom) and node.module != "__future__":
            for alias in node.names:
                out["uses"] += [{"file": rel, "name": n} for n in (alias.name, alias.asname) if n]
        if isinstance(node, ast.Import):
            for alias in node.names:
                out["uses"] += [{"file": rel, "name": n} for n in [*alias.name.split("."), alias.asname] if n]


def read_tests(root: Path, rel: str, out: dict) -> None:
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
            out["tests"].append({"file": rel, "name": node.name})
        if isinstance(node, ast.ClassDef) and (is_test_class(node) or node.name.startswith("Test")):
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)) and member.name.startswith("test"):
                    out["tests"].append({"file": rel, "name": f"{node.name}.{member.name}"})


def files(root: Path, dirs: list[str], pattern: str) -> list[str]:
    found: list[str] = []
    for d in dirs:
        found += [p.relative_to(root).as_posix() for p in (root / d).rglob(pattern)]
    return sorted(set(found))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root")
    parser.add_argument("--sources", nargs="*", default=[])
    parser.add_argument("--tests", nargs="*", default=[])
    args = parser.parse_args()
    root = Path(args.root).resolve()

    sources = files(root, args.sources, "*.py")
    out: dict = {
        "language": "python",
        "files": sources,
        "units": [],
        "types": [],
        "members": [],
        "constants": [],
        "exports": [],
        "uses": [],
        "tests": [],
        "dynamicTests": [],
    }
    for rel in sources:
        read_module(root, rel, out)
    # HYR-7: every Python file under the test roots holds tests.
    for rel in files(root, args.tests, "*.py"):
        read_tests(root, rel, out)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
