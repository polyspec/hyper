"""The scopes of the Python files for the recipe check (HYR-5, HYR-7): what each function and method writes about the
class of a receiver, read with ``ast`` only, and the step registry of the case runner.

A scope is a top-level function (``name``) or a method (``Class.method``). Its ``uses`` are the member reads and the
constructions that it writes, as small expression trees; ``assigns``, ``loops`` and ``parameters`` give the written
classes of its variables. A class reference names the file that declares the class and its name; the reader resolves a
name through the imports of the file and the files that git tracks, and leaves any other name without a class. The check
(``stated.mts``) evaluates the classes; the reader resolves nothing against the spec.
"""

from __future__ import annotations

import ast
from pathlib import Path

OTHER: dict = {"kind": "other"}
NONE_NAMES = {"None", "NoneType"}
# The generic types whose one argument is the class of their items.
LIST_NAMES = {
    "list",
    "List",
    "Sequence",
    "MutableSequence",
    "Iterable",
    "Iterator",
    "Collection",
    "set",
    "Set",
    "frozenset",
    "FrozenSet",
    "AbstractSet",
    "MutableSet",
    "deque",
    "Deque",
}


class Files:
    """The parsed files of the tree and the resolution of a name of a file to a class, a function or a module."""

    def __init__(self, root: Path, rels: list[str]) -> None:
        self.rels = rels
        self.tracked = set(rels)
        self.trees = {
            rel: ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
            for rel in rels
        }
        self.classes: dict[str, dict[str, ast.ClassDef]] = {}
        self.functions: dict[str, set[str]] = {}
        self.imports: dict[str, dict[str, tuple[int, str, str]]] = {}
        for rel, tree in self.trees.items():
            self.classes[rel] = {
                n.name: n for n in tree.body if isinstance(n, ast.ClassDef)
            }
            self.functions[rel] = {
                n.name
                for n in tree.body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
            self.imports[rel] = bindings(tree)

    def module(self, rel: str, level: int, module: str) -> str | None:
        """The tracked file of a module that an import of `rel` names: relative to the package of the file for a level
        above zero, else the one tracked file whose path ends with the module path."""
        parts = module.split(".") if module else []
        if level > 0:
            base = "/".join([*rel.split("/")[:-level], *parts])
            candidates = [f"{base}.py", f"{base}/__init__.py"]
            return next((c for c in candidates if c in self.tracked), None)
        suffix = "/".join(parts)
        found = [
            f
            for f in self.rels
            if f.endswith(f"/{suffix}.py") or f.endswith(f"/{suffix}/__init__.py")
        ]
        return found[0] if len(found) == 1 else None

    def resolve(self, rel: str, name: str, depth: int = 0) -> dict | None:
        """The class, the function or the module that a name of a file is: a class or a function that the file defines,
        or what an import of the file binds, followed through the re-exports of another file."""
        if depth > 8:
            return None
        if name in self.classes.get(rel, {}):
            return {"kind": "class", "file": rel, "name": name}
        if name in self.functions.get(rel, set()):
            return {"kind": "function", "file": rel, "name": name}
        bound = self.imports.get(rel, {}).get(name)
        if bound is None:
            return None
        level, module, original = bound
        if original == "":
            target = self.module(rel, level, module)
            return None if target is None else {"kind": "module", "file": target}
        target = self.module(rel, level, module)
        sub = self.module(rel, level, f"{module}.{original}" if module else original)
        if sub is not None and (
            target is None or original not in self.classes.get(target, {})
        ):
            return {"kind": "module", "file": sub}
        if target is None:
            return None
        return self.resolve(target, original, depth + 1)

    def attribute(self, module_file: str, name: str) -> dict | None:
        """A name read after a module: a class, a function or a submodule of the package of the module."""
        found = self.resolve(module_file, name)
        if found is not None:
            return found
        if module_file.endswith("/__init__.py"):
            package = module_file[: -len("/__init__.py")]
            for candidate in (f"{package}/{name}.py", f"{package}/{name}/__init__.py"):
                if candidate in self.tracked:
                    return {"kind": "module", "file": candidate}
        return None


def bindings(tree: ast.Module) -> dict[str, tuple[int, str, str]]:
    """The names that the imports of a file bind: `from m import X as Y` binds Y to (level, m, X) and `import a.b as c`
    binds c to (0, a.b, "")."""
    names: dict[str, tuple[int, str, str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names[alias.asname or alias.name] = (
                    node.level,
                    node.module or "",
                    alias.name,
                )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname is not None:
                    names[alias.asname] = (0, alias.name, "")
                else:
                    first = alias.name.split(".")[0]
                    names[first] = (0, first, "")
    return names


def _without_none(node: ast.BinOp) -> ast.expr | None:
    """The one side of a union `X | None` that is not None, or None for a union of two other types."""
    parts = [
        p
        for p in (node.left, node.right)
        if not (isinstance(p, ast.Constant) and p.value is None)
        and not (isinstance(p, ast.Name) and p.id in NONE_NAMES)
    ]
    return parts[0] if len(parts) == 1 else None


class Scope:
    """The reading of one function or method: its expressions, assignments, loops and parameters."""

    def __init__(self, files: Files, rel: str, name: str, cls: str | None) -> None:
        self.files = files
        self.rel = rel
        self.out: dict = {
            "file": rel,
            "name": name,
            "parameters": [],
            "uses": [],
            "assigns": [],
            "loops": [],
        }
        if cls is not None:
            self.out["class"] = cls
        self.seen: set[str] = set()
        # The names that the scope binds itself, which hide a name of the module.
        self.locals: set[str] = set()

    def class_of_name(self, name: str) -> dict | None:
        found = self.files.resolve(self.rel, name)
        return (
            {"file": found["file"], "name": found["name"]}
            if found is not None and found["kind"] == "class"
            else None
        )

    def type_of(self, node: ast.expr | None) -> dict | None:
        """The class of a written type: a name, a dotted name after a module, a string of one, inside `Optional[...]` or
        `X | None`; a union of two classes and any other type give none."""
        if node is None:
            return None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                return self.type_of(ast.parse(node.value, mode="eval").body)
            except SyntaxError:
                return None
        if isinstance(node, ast.Subscript):
            base = node.value
            name = (
                base.attr
                if isinstance(base, ast.Attribute)
                else getattr(base, "id", "")
            )
            return self.type_of(node.slice) if name == "Optional" else None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            only = _without_none(node)
            return None if only is None else self.type_of(only)
        expr = self.expression(node)
        if expr["kind"] == "class":
            return {"file": expr["file"], "name": expr["name"]}
        return None

    def items_of(self, node: ast.expr | None) -> dict | None:
        """The class inside a written list type: `list[X]`, `Sequence[X]`, `Iterable[X]`, `set[X]`, `tuple[X, ...]` and
        the like, also inside `Optional[...]`, `X | None` or a string."""
        if node is None:
            return None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                return self.items_of(ast.parse(node.value, mode="eval").body)
            except SyntaxError:
                return None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            only = _without_none(node)
            return None if only is None else self.items_of(only)
        if not isinstance(node, ast.Subscript):
            return None
        base = node.value
        name = base.attr if isinstance(base, ast.Attribute) else getattr(base, "id", "")
        if name == "Optional":
            return self.items_of(node.slice)
        if name == "tuple":
            inner = node.slice
            if (
                isinstance(inner, ast.Tuple)
                and len(inner.elts) == 2
                and isinstance(inner.elts[1], ast.Constant)
                and inner.elts[1].value is Ellipsis
            ):
                return self.type_of(inner.elts[0])
            return None
        return self.type_of(node.slice) if name in LIST_NAMES else None

    def expression(self, node: ast.expr) -> dict:
        """The expression tree of a node (HYR-5): a receiver whose class is written, a member read, a construction, a
        conditional, or `other`."""
        if isinstance(node, ast.Name):
            if node.id in ("self", "cls"):
                return {"kind": "own"}
            if node.id in self.locals:
                return {"kind": "variable", "name": node.id}
            found = self.files.resolve(self.rel, node.id)
            if found is None:
                return {"kind": "variable", "name": node.id}
            if found["kind"] == "class":
                return {"kind": "class", "file": found["file"], "name": found["name"]}
            if found["kind"] == "module":
                return {"kind": "module", "file": found["file"]}
            return OTHER
        if isinstance(node, ast.Attribute):
            base = self.expression(node.value)
            if base["kind"] == "module":
                found = self.files.attribute(base["file"], node.attr)
                if found is not None and found["kind"] == "class":
                    return {
                        "kind": "class",
                        "file": found["file"],
                        "name": found["name"],
                    }
                if found is not None and found["kind"] == "module":
                    return {"kind": "module", "file": found["file"]}
                if found is not None and found["kind"] == "function":
                    return {
                        "kind": "member",
                        "of": {"kind": "module", "file": found["file"]},
                        "name": found["name"],
                        "call": False,
                    }
            return {"kind": "member", "of": base, "name": node.attr, "call": False}
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "super":
                return {"kind": "parent"}
            if isinstance(func, ast.Name):
                found = self.files.resolve(self.rel, func.id)
                if found is not None and found["kind"] == "function":
                    return {
                        "kind": "member",
                        "of": {"kind": "module", "file": found["file"]},
                        "name": found["name"],
                        "call": True,
                    }
            callee = self.expression(func)
            if callee["kind"] == "class":
                return {
                    "kind": "new",
                    "class": {"file": callee["file"], "name": callee["name"]},
                }
            if callee["kind"] == "member":
                return {**callee, "call": True}
            return OTHER
        if isinstance(node, ast.IfExp):
            return {
                "kind": "either",
                "of": [self.expression(node.body), self.expression(node.orelse)],
            }
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            return {"kind": "either", "of": [self.expression(v) for v in node.values]}
        if isinstance(node, ast.NamedExpr):
            return self.expression(node.value)
        return OTHER

    def use(self, expr: dict) -> None:
        if expr["kind"] not in ("member", "new"):
            return
        key = repr(expr)
        if key not in self.seen:
            self.seen.add(key)
            self.out["uses"].append(expr)

    def returns(self, node: ast.expr | None) -> None:
        """Records the written return type of the function: one class, where `Self` is the class of the method."""
        own = self.out.get("class")
        is_self = (isinstance(node, ast.Name) and node.id == "Self") or (
            isinstance(node, ast.Constant) and node.value == "Self"
        )
        written = (
            {"file": self.rel, "name": own}
            if is_self and own is not None
            else self.type_of(node)
        )
        if written is not None:
            self.out["returns"] = written

    def parameters(self, args: ast.arguments) -> None:
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            if arg.arg in ("self", "cls"):
                continue
            self.locals.add(arg.arg)
            entry: dict = {"name": arg.arg}
            written = self.type_of(arg.annotation)
            if written is not None:
                entry["type"] = written
            items = self.items_of(arg.annotation)
            if items is not None:
                entry["items"] = items
            self.out["parameters"].append(entry)

    def target(self, node: ast.expr) -> str | dict | None:
        if isinstance(node, ast.Name):
            return node.id
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in ("self", "cls")
        ):
            return {"own": node.attr}
        return None

    def assign(
        self, target: ast.expr, value: ast.expr | None, written: ast.expr | None
    ) -> None:
        name = self.target(target)
        if name is None:
            return
        entry: dict = {
            "target": name,
            "value": OTHER if value is None else self.expression(value),
        }
        typed = self.type_of(written)
        if typed is not None:
            entry["type"] = typed
        self.out["assigns"].append(entry)

    def loop(self, target: ast.expr, over: ast.expr) -> None:
        if isinstance(target, ast.Name):
            self.out["loops"].append(
                {"variable": target.id, "over": self.expression(over)}
            )

    def read(self, body: list[ast.stmt]) -> None:
        """Reads every statement of the body, a nested function or lambda included; an assignment target is no use."""
        targets: set[int] = set()
        callees: set[int] = set()
        for stmt in body:
            for node in ast.walk(stmt):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                    self.locals.add(node.id)
                elif isinstance(node, ast.arg):
                    self.locals.add(node.arg)
                elif isinstance(node, ast.ExceptHandler) and node.name is not None:
                    self.locals.add(node.name)
        for stmt in body:
            for node in ast.walk(stmt):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        targets.add(id(target))
                        self.assign(target, node.value, None)
                elif isinstance(node, ast.AnnAssign):
                    targets.add(id(node.target))
                    self.assign(node.target, node.value, node.annotation)
                elif isinstance(node, ast.AugAssign):
                    targets.add(id(node.target))
                elif isinstance(node, (ast.For, ast.AsyncFor)):
                    self.loop(node.target, node.iter)
                elif isinstance(node, ast.comprehension):
                    self.loop(node.target, node.iter)
                elif isinstance(
                    node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
                ):
                    self.parameters(node.args)
                elif isinstance(node, ast.Call):
                    callees.add(id(node.func))
        for stmt in body:
            for node in ast.walk(stmt):
                if id(node) in targets or id(node) in callees:
                    continue
                if isinstance(node, (ast.Attribute, ast.Call)):
                    self.use(self.expression(node))


def class_entry(files: Files, rel: str, node: ast.ClassDef) -> dict:
    """A class of a file: the classes that it extends and the written types of its properties."""
    scope = Scope(files, rel, node.name, None)
    extends = []
    for base in node.bases:
        # A generic base, `Base[T]`, is the class `Base`.
        expr = scope.expression(base.value if isinstance(base, ast.Subscript) else base)
        if expr["kind"] == "class":
            extends.append({"file": expr["file"], "name": expr["name"]})
    properties = []
    for stmt in node.body:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            entry: dict = {"name": stmt.target.id}
            written = scope.type_of(stmt.annotation)
            if written is not None:
                entry["type"] = written
            items = scope.items_of(stmt.annotation)
            if items is not None:
                entry["items"] = items
            properties.append(entry)
    return {
        "file": rel,
        "name": node.name,
        "extends": extends,
        "properties": properties,
    }


def read_scopes(root: Path, rels: list[str], out: dict) -> Files:
    """Adds the classes and the scopes of every file of `rels` to the output."""
    files = Files(root, rels)
    out["classes"] = []
    out["scopes"] = []
    for rel in rels:
        for node in files.trees[rel].body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                scope = Scope(files, rel, node.name, None)
                scope.parameters(node.args)
                scope.returns(node.returns)
                scope.read(node.body)
                out["scopes"].append(scope.out)
            elif isinstance(node, ast.ClassDef):
                out["classes"].append(class_entry(files, rel, node))
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        scope = Scope(files, rel, f"{node.name}.{item.name}", node.name)
                        scope.parameters(item.args)
                        scope.returns(item.returns)
                        scope.read(item.body)
                        out["scopes"].append(scope.out)
    return files


def read_registry(files: Files, rel: str) -> list[dict]:
    """The entries of the dict `STEPS` of the registry file: `(case file, section): module.function`."""
    if rel not in files.trees:
        raise SystemExit(f"read_python.py: the registry {rel} is no tracked file")
    entries = []
    for node in files.trees[rel].body:
        if not (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "STEPS" for t in node.targets)
            and isinstance(node.value, ast.Dict)
        ):
            continue
        for key, value in zip(node.value.keys, node.value.values):
            if not (
                isinstance(key, ast.Tuple)
                and len(key.elts) == 2
                and all(
                    isinstance(e, ast.Constant) and isinstance(e.value, str)
                    for e in key.elts
                )
            ):
                continue
            step = Scope(files, rel, "STEPS", None).expression(value)
            target = None
            if step["kind"] == "member" and step["of"]["kind"] == "module":
                target = {"file": step["of"]["file"], "name": step["name"]}
            entries.append(
                {
                    "file": key.elts[0].value,
                    "section": key.elts[1].value,
                    "step": target or {"file": "", "name": ast.unparse(value)},
                }
            )
    return entries
