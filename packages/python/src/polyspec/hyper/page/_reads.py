"""The read paths of the routes, which `hyper-build-server` of `@polyspec/hyper-cli` writes to `reads.json`, and
the data that they keep (HY-73). A read node is True when the value at its path is read whole, and otherwise names
the keys read below it and, under ``each``, what is read of every entry of a map or element of a list."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Union

Node = Union[bool, dict]


class Reads:
    """Keeps the read nodes of every route of one server program."""

    def __init__(self, routes: dict):
        self._routes = routes

    @staticmethod
    def open(program: str) -> "Reads":
        """Reads ``reads.json`` of a server program directory."""
        file = Path(program) / "reads.json"
        try:
            reads = json.loads(file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise ValueError(
                f"{file} of the server program {program} is missing; "
                "hyper-build-server of @polyspec/hyper-cli builds it"
            ) from None
        except ValueError as error:
            raise ValueError(f"{file} is not valid JSON or UTF-8: {error}") from None
        if not isinstance(reads, dict) or not isinstance(reads.get("routes"), dict):
            raise ValueError(f"{file} has no routes")
        return Reads(reads["routes"])

    def shared(self, route: str, shared: dict) -> dict:
        """Returns the shared data that a route keeps."""
        entry = self._routes.get(route)
        return Reads._keep_map(
            shared,
            Reads._node(entry.get("shared") if isinstance(entry, dict) else None),
        )

    def region(self, route: str, region: str, data: dict) -> dict:
        """Returns the data of a region that a route keeps."""
        entry = self._routes.get(route)
        regions = entry.get("regions") if isinstance(entry, dict) else None
        node = None
        if isinstance(regions, dict):
            node = regions.get(region)
        return Reads._keep_map(data, Reads._node(node))

    @staticmethod
    def keep(value, node: Node):
        """Returns the part of a value that a read node keeps: a map keeps the named keys and every key under
        ``each``, an empty map stays a map, a list keeps its length with None at an index that nothing names, and
        any other value stays as it is."""
        if node is True:
            return value
        return (
            Reads._keep_array(value, node) if isinstance(value, (dict, list)) else value
        )

    @staticmethod
    def _keep_array(value: Union[dict, list], node: dict) -> Union[dict, list]:
        if isinstance(value, list):
            return [
                None
                if (child := Reads._child(node, str(index))) is None
                else Reads.keep(item, child)
                for index, item in enumerate(value)
            ]
        kept = {}
        for key, item in value.items():
            child = Reads._child(node, str(key))
            if child is not None:
                kept[key] = Reads.keep(item, child)
        return kept

    @staticmethod
    def _keep_map(data: dict, node: Node) -> dict:
        if node is True:
            return data
        kept = Reads._keep_array(data, node)
        return kept if isinstance(kept, dict) else {}

    @staticmethod
    def _node(node: object) -> Node:
        """Returns a read node of `reads.json`, which is True or a map; another value fails."""
        if isinstance(node, bool) or isinstance(node, dict):
            return node
        raise ValueError("reads.json has a read node that is neither true nor a map")

    @staticmethod
    def _named_keys(node: dict) -> Optional[dict]:
        keys = node.get("keys")
        if keys is not None and not isinstance(keys, dict):
            raise ValueError("reads.json has keys that are not a map")
        return keys

    @staticmethod
    def _each(node: dict) -> Optional[Node]:
        each = node.get("each")
        return None if each is None else Reads._node(each)

    @staticmethod
    def _child(node: dict, key: str) -> Optional[Node]:
        named = Reads._named_keys(node)
        named_node = (
            None if named is None or key not in named else Reads._node(named[key])
        )
        each = Reads._each(node)
        if named_node is None or each is None:
            return named_node if named_node is not None else each
        return Reads._merged_node(named_node, each)

    @staticmethod
    def _merged_node(a: Node, b: Node) -> Node:
        if a is True or b is True:
            return True
        merged: dict = {}
        a_keys, b_keys = Reads._named_keys(a), Reads._named_keys(b)
        if a_keys is not None or b_keys is not None:
            keys = dict(a_keys or {})
            for key, node in (b_keys or {}).items():
                node = Reads._node(node)
                keys[key] = (
                    Reads._merged_node(Reads._node(keys[key]), node)
                    if key in keys
                    else node
                )
            merged["keys"] = keys
        a_each, b_each = Reads._each(a), Reads._each(b)
        if a_each is not None or b_each is not None:
            merged["each"] = (
                Reads._merged_node(a_each, b_each)
                if a_each is not None and b_each is not None
                else (a_each or b_each)
            )
        return merged
