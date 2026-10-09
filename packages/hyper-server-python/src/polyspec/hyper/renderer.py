"""Renders documents and single regions with the template package `polyspec-template` (HY-12, HY-13, HY-30, HY-31,
HY-48). The server program that `hyper-build-server` of `@polyspec/hyper-build` built holds the templates and the
read paths; the Python server reads its `templates` directory and its `reads.json` and needs neither `program.php`
nor `program.json`, which the generated PHP program of the same templates uses. The caller binds each root of a
document once with `bind`, and every render merges the bound roots, so the renders of a document check no value
again (VAL-22)."""

from __future__ import annotations

from pathlib import Path

from polyspec.template import AstProgram, Engine, EngineOptions, FsLoader, RenderOptions
from polyspec.template import bind as template_bind
from polyspec.template import merge as template_merge

# The reserved template that the embedded data renders (HY-31).
DATA_NAME = 'hyper/data.tpl'


class Renderer:
    """Renders the documents and regions of one server program."""

    def __init__(self, program: Engine, timezone: str):
        self._program = program
        self.timezone = timezone

    @staticmethod
    def open(program: str, timezone: str) -> 'Renderer':
        """Opens the server program that `hyper-build-server` of `@polyspec/hyper-build` wrote to a directory; a
        missing build fails here and names the missing file (HY-48)."""
        templates = Path(program) / 'templates'
        reads = Path(program) / 'reads.json'
        for path, is_directory in ((reads, False), (templates, True)):
            if not (path.is_dir() if is_directory else path.is_file()):
                raise ValueError(f'{path} of the server program {program} is missing; '
                                 'hyper-build-server of @polyspec/hyper-build builds it')
        return Renderer(Engine(AstProgram(EngineOptions(loader=FsLoader(str(templates))))), timezone)

    @staticmethod
    def bind(value: dict):
        """Binds a root of the data of a document once, with the bound map of the template package (VAL-22)."""
        return template_bind(value)

    @staticmethod
    def merge(shared, data):
        """Returns the bound root of a region rendered alone: merge(shared, data) (HY-13)."""
        return template_merge(shared, data)

    def document(self, layout: str, title: str, shared, regions: dict, page: str, route_regions: dict,
                 data) -> str:
        """Renders the document: the layout with the title, the embedded data and every manifest region rendered
        alone as HTML definitions; the page region receives its route regions the same way.

        `regions` and `route_regions` map a name to `{'template': str, 'data': <bound root>}`; `data` is the bound
        root of `{# data}` (HY-31) or None when the document embeds no data (HY-92)."""
        define = {
            'title': {'html': self.render(title, shared, {})},
            'data': {'html': '' if data is None else self.render(DATA_NAME, data, {})},
        }
        for name, region in regions.items():
            define[name] = {'html': self.alone(region['template'], shared, region['data'],
                                               route_regions if name == page else {})}
        return self.render(layout, shared, define)

    def alone(self, template: str, shared, data, route_regions: dict | None = None) -> str:
        """Renders one template alone with merge(shared, data) as root data; `route_regions` passes the route
        regions of a page region, each rendered alone, as HTML definitions."""
        define = {}
        for name, region in (route_regions or {}).items():
            define[name] = {'html': self.alone(region['template'], shared, region['data'])}
        return self.render(template, template_merge(shared, data), define)

    def render(self, template: str, assign, define: dict) -> str:
        """Renders one template with an assigned bound root and HTML definitions (HY-14)."""
        options = RenderOptions(env={'timezone': self.timezone})
        if define != {}:
            options.define = define
        return self._program.render(template, assign, options)
