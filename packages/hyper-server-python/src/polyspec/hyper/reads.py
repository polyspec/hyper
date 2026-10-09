"""The read paths of the routes, which `hyper-build-server` of `@polyspec/hyper-build` writes to `reads.json`, and
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
    def open(program: str) -> 'Reads':
        """Reads ``reads.json`` of a server program directory."""
        file = Path(program) / 'reads.json'
        try:
            reads = json.loads(file.read_text(encoding='utf-8'))
        except FileNotFoundError:
            raise ValueError(f'{file} of the server program {program} is missing; '
                             'hyper-build-server of @polyspec/hyper-build builds it') from None
        if not isinstance(reads, dict) or not isinstance(reads.get('routes'), dict):
            raise ValueError(f'{file} has no routes')
        return Reads(reads['routes'])

    def shared(self, route: str, shared: dict) -> dict:
        """Returns the shared data that a route keeps."""
        entry = self._routes.get(route)
        return _keep_map(shared, _node(_entry_node(entry, 'shared')))

    def region(self, route: str, region: str, data: dict) -> dict:
        """Returns the data of a region that a route keeps."""
        entry = self._routes.get(route)
        regions = _entry_node(entry, 'regions')
        node = None
        if isinstance(regions, dict):
            node = regions.get(region)
        return _keep_map(data, _node(node))

    @staticmethod
    def keep(value, node: Node):
        """Returns the part of a value that a read node keeps: a map keeps the named keys and every key under
        ``each``, an empty map stays a map, a list keeps its length with None at an index that nothing names, and
        any other value stays as it is."""
        if node is True:
            return value
        if isinstance(value, dict):
            return _keep_dict(value, node)
        if isinstance(value, list):
            return _keep_list(value, node)
        return value


def _entry_node(entry: object, key: str) -> object:
    return entry.get(key) if isinstance(entry, dict) else None


def _keep_dict(value: dict, node: dict) -> dict:
    if value == {}:
        return {}
    kept = {}
    for key, item in value.items():
        child = _child(node, str(key))
        if child is not None:
            kept[key] = Reads.keep(item, child)
    return kept


def _keep_list(value: list, node: dict) -> list:
    return [None if (child := _child(node, str(index))) is None else Reads.keep(item, child)
            for index, item in enumerate(value)]


def _keep_map(data: dict, node: Node) -> dict:
    if node is True:
        return data
    return _keep_dict(data, node)


def _node(node: object) -> Node:
    """Returns a read node of `reads.json`, which is True or a map; another value fails."""
    if isinstance(node, bool) or isinstance(node, dict):
        return node
    raise ValueError('reads.json has a read node that is neither true nor a map')


def _keys(node: dict) -> Optional[dict]:
    keys = node.get('keys')
    if keys is not None and not isinstance(keys, dict):
        raise ValueError('reads.json has keys that are not a map')
    return keys


def _each(node: dict) -> Optional[Node]:
    each = node.get('each')
    return None if each is None else _node(each)


def _child(node: dict, key: str) -> Optional[Node]:
    named = _keys(node)
    named_node = None if named is None or key not in named else _node(named[key])
    each = _each(node)
    if named_node is None or each is None:
        return named_node if named_node is not None else each
    return _merge(named_node, each)


def _merge(a: Node, b: Node) -> Node:
    if a is True or b is True:
        return True
    merged: dict = {}
    a_keys, b_keys = _keys(a), _keys(b)
    if a_keys is not None or b_keys is not None:
        keys = dict(a_keys or {})
        for key, node in (b_keys or {}).items():
            node = _node(node)
            keys[key] = _merge(_node(keys[key]), node) if key in keys else node
        merged['keys'] = keys
    a_each, b_each = _each(a), _each(b)
    if a_each is not None or b_each is not None:
        merged['each'] = _merge(a_each, b_each) if a_each is not None and b_each is not None else (a_each or b_each)
    return merged
