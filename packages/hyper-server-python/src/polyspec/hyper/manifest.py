"""The application manifest: layout, title, regions and routes (HY-1, HY-2)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from .region import Region
from .router import Router

_REGION_NAME = re.compile(r'[A-Za-z][A-Za-z0-9_-]*\Z')
_TOPIC = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')


class Manifest:
    """The checked manifest of an application."""

    def __init__(self, layout: str, title: str, regions: list[Region], page: Region,
                 routes: dict[str, dict], router: Router):
        self.layout = layout
        self.title = title
        self.regions = regions
        self.page = page
        self.routes = routes
        self.router = router

    @staticmethod
    def from_file(file: str) -> 'Manifest':
        """Reads and checks a manifest file."""
        path = Path(file)
        if not path.is_file():
            raise ValueError(f'manifest {file} does not exist')
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except json.JSONDecodeError as error:
            raise ValueError(f'manifest {file} is not JSON: {error}') from None
        if not isinstance(data, dict) or not isinstance(data.get('layout'), str) \
                or not isinstance(data.get('title'), str):
            raise ValueError(f'manifest {file} has no layout or title template')

        regions: dict[str, Region] = {}
        page: Optional[Region] = None
        for region in _entries(data, 'regions'):
            name = region.get('name') if isinstance(region.get('name'), str) else ''
            if _REGION_NAME.fullmatch(name) is None or name in ('layout', 'title', 'data') or name in regions:
                raise ValueError(f'manifest region name {name} is not allowed')
            is_page = region.get('page') == True  # noqa: E712 - the manifest states true, not truthiness
            template = region.get('template')
            if isinstance(template, str) == is_page:
                raise ValueError(f'manifest region {name} must have a template unless it is the page region')
            declared_uses = region.get('uses', [])
            if not isinstance(declared_uses, list):
                raise ValueError(f'manifest region {name} uses an invalid topic')
            uses = []
            for topic in declared_uses:
                if not isinstance(topic, str) or _TOPIC.fullmatch(topic) is None:
                    raise ValueError(f'manifest region {name} uses an invalid topic')
                uses.append(topic)
            # HY-37: only route regions change in the browser, so only they keep values.
            if 'keep' in region:
                raise ValueError(f'manifest region {name} cannot keep values; only route regions keep values')
            regions[name] = Region(name, is_page, template if isinstance(template, str) else None, uses)
            if is_page:
                if page is not None:
                    raise ValueError('manifest declares more than one page region')
                page = regions[name]
        if page is None:
            raise ValueError('manifest declares no page region')

        routes: dict[str, dict] = {}
        region_names = set(regions)
        for route in _entries(data, 'routes'):
            name = route.get('name') if isinstance(route.get('name'), str) else ''
            title = route.get('title')
            template = route.get('template')
            route_path = route.get('path')
            if name == '' or name in routes or not all(isinstance(item, str) for item in (title, template, route_path)):
                raise ValueError(f'manifest route {name} is duplicated or incomplete')
            if route_path.startswith('/_hyper'):
                raise ValueError(f'manifest route {name} uses the reserved path /_hyper (HY-40)')
            route_regions: list[Region] = []
            for region in _entries(route, 'regions'):
                region_name = region.get('name') if isinstance(region.get('name'), str) else ''
                region_template = region.get('template')
                if _REGION_NAME.fullmatch(region_name) is None or region_name in region_names \
                        or not isinstance(region_template, str):
                    raise ValueError(f'manifest route {name} has an invalid or duplicated region {region_name}')
                region_names.add(region_name)
                route_regions.append(Region(region_name, False, region_template, [], _keep(region, region_name)))
            routes[name] = {
                'name': name,
                'path': route_path,
                'title': title,
                'template': template,
                'post': route.get('post') == True,  # noqa: E712
                'regions': route_regions,
            }

        return Manifest(data['layout'], data['title'], list(regions.values()), page, routes,
                        Router([{'name': route['name'], 'path': route['path']} for route in routes.values()]))

    def region(self, name: str) -> Optional[Region]:
        """Returns the manifest region or the route region with a name, or None."""
        for region in self.regions:
            if region.name == name:
                return region
        for route in self.routes.values():
            for region in route['regions']:
                if region.name == name:
                    return region
        return None


def _entries(obj: dict, key: str) -> list[dict]:
    """Returns the objects of the list under a key, which may be absent (HY-2)."""
    declared = obj.get(key, [])
    if not isinstance(declared, list):
        raise ValueError(f'manifest {key} is not a list')
    for entry in declared:
        if not isinstance(entry, dict):
            raise ValueError(f'manifest {key} contains a value that is not an object')
    return declared


def _keep(region: dict, name: str) -> dict[str, str]:
    """Returns the kept paths of a route region by path; the region checks the paths and kinds (HY-37)."""
    declared = region.get('keep', [])
    if not isinstance(declared, dict):
        raise ValueError(f'region {name} has kept paths that are not an object')
    keep: dict[str, str] = {}
    for path, kind in declared.items():
        if not isinstance(path, str) or not isinstance(kind, str):
            raise ValueError(f'region {name} has an invalid kept path {path}')
        keep[path] = kind
    return keep
