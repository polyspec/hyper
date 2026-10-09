"""Route matching (HY-4 to HY-8, HY-49). The PHP and the JavaScript router implement the same rules; all three pass
the cases of conformance/routes.json and conformance/rest.json."""

from __future__ import annotations

import re
from typing import Optional

_LITERAL = re.compile(r'[A-Za-z0-9._~-]+\Z')
_PARAMETER = re.compile(r'\{([A-Za-z_][A-Za-z0-9_]*)\}\Z')
_REST = re.compile(r'\{([A-Za-z_][A-Za-z0-9_]*)\*\}\Z')
_BAD_PERCENT = re.compile(r'%(?![0-9A-Fa-f]{2})')
_UTF8 = re.compile(r'[\uD800-\uDFFF]')

# One route segment: a literal, a parameter or a rest parameter.
Segment = tuple[str, str]


class Router:
    """Compiles route paths and returns the first route that matches a request path (HY-5 to HY-7)."""

    def __init__(self, routes: list[dict[str, str]]):
        self._routes = [(route['name'], _compile(route['path'])) for route in routes]

    def match(self, path: str) -> Optional[dict[str, object]]:
        """Returns ``{'name': str, 'params': dict}`` of the first route that matches, or None (HY-5 to HY-7)."""
        if not path.startswith('/'):
            return None
        parts = [] if path == '/' else path[1:].split('/')
        for name, segments in self._routes:
            params = _match_segments(segments, parts)
            if params is not None:
                return {'name': name, 'params': params}
        return None


def strip_base_path(path: str, base_path: str) -> Optional[str]:
    """Removes a base path from a request path; returns None when the path is outside the base path (HY-8)."""
    if base_path == '':
        return path
    if path == base_path:
        return '/'
    return path[len(base_path):] if path.startswith(base_path + '/') else None


def _compile(path: str) -> list[Segment]:
    """Compiles one route path; an invalid path fails here (HY-4)."""
    if not path.startswith('/'):
        raise ValueError(f'route path {path} does not start with /')
    if path == '/':
        return []
    parts = path[1:].split('/')
    segments: list[Segment] = []
    names: set[str] = set()
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        literal = _LITERAL.fullmatch(part)
        if literal is not None:
            segments.append(('literal', part))
            continue
        parameter = _PARAMETER.fullmatch(part)
        if parameter is not None and parameter.group(1) not in names:
            names.add(parameter.group(1))
            segments.append(('param', parameter.group(1)))
            continue
        rest = _REST.fullmatch(part) if last else None
        if rest is not None and rest.group(1) not in names:
            segments.append(('rest', rest.group(1)))
            continue
        raise ValueError(f'route path {path} has an invalid segment {part}')
    return segments


def _match_segments(segments: list[Segment], parts: list[str]) -> Optional[dict[str, str]]:
    last: Optional[Segment] = segments[-1] if segments else None
    if last is not None and last[0] == 'rest':
        fixed = segments[:-1]
        if len(parts) < len(fixed):
            return None
        remaining = parts[len(fixed):]
        for part in remaining:
            if part != '' and _decode_segment(part) is None:
                return None
        params = _match_segments(fixed, parts[:len(fixed)])
        if params is None:
            return None
        params[last[1]] = '/' + '/'.join(remaining)
        return params
    if len(segments) != len(parts):
        return None
    params: dict[str, str] = {}
    for (kind, value), part in zip(segments, parts):
        if kind == 'literal':
            if value != part:
                return None
            continue
        decoded = None if part == '' else _decode_segment(part)
        if decoded is None:
            return None
        params[value] = decoded
    return params


def _decode_segment(part: str) -> Optional[str]:
    """Decodes %XX sequences to bytes and requires valid UTF-8; returns None for a malformed segment (HY-6)."""
    if _BAD_PERCENT.search(part) is not None:
        return None
    decoded = bytearray()
    index = 0
    while index < len(part):
        char = part[index]
        if char == '%':
            decoded.append(int(part[index + 1:index + 3], 16))
            index += 3
            continue
        decoded.extend(char.encode('latin-1'))
        index += 1
    try:
        text = bytes(decoded).decode('utf-8')
    except UnicodeDecodeError:
        return None
    return None if _UTF8.search(text) is not None else text
