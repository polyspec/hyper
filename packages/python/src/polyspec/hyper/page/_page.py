"""Renders the page of a route as a document or as JSON (HY-12 to HY-19, HY-26, HY-31, HY-38, HY-44, HY-52, HY-53,
HY-69, HY-73, HY-75, HY-92, HY-124)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable, Optional

from ..app._context import Context
from ..app._core import core
from ..data._data_model import DataModel
from ..session._flash import Flash
from ..data._json_codec import JsonCodec
from ..data._json_decode_error import JsonDecodeError
from ..data._kept import Kept
from ._manifest import Manifest
from ._region_planner import RegionPlanner
from ..session._session import Session
from ..app.container import Container
from ..http.reply import Reply
from ..http.request import Request
from ..http.response import Response

if TYPE_CHECKING:
    from ._reads import Reads
    from ._renderer import Renderer

_JSON = "application/vnd.hyper+json"


class Page:
    """The page rendering of one application: its manifest, its shared handler, its region loaders and its server
    program (HY-48)."""

    def __init__(
        self,
        manifest: Manifest,
        shared: Optional[Callable],
        region_loaders: dict,
        container: Container,
        renderer: "Renderer",
        reads: "Reads",
        build: str,
        timezone: str,
        https: bool,
        context: Optional[Callable],
        vary: str,
    ):
        self._manifest = manifest
        self._shared_handler = shared
        self._region_loaders = region_loaders
        self._container = container
        self._renderer = renderer
        self._reads = reads
        self._build = build
        self._timezone = timezone
        self._https = https
        self._context_handler = context
        # The `Vary` of a response that `Accept` and the context decide (HY-117).
        self._vary_text = vary

    def respond(
        self,
        request: Request,
        route: dict,
        handler: dict,
        session: Session,
        flash: Flash,
        status: int,
        invalid: dict,
        reply: Reply,
        base_path: str,
    ) -> Response:
        """Renders the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-31, HY-38, HY-44, HY-52,
        HY-53, HY-69, HY-73, HY-92)."""
        json_request = request.wants_json()
        provided = {Request: request, Reply: reply, "request": request, "reply": reply}
        # HY-124: the context handler runs once, after the action of the request and before the shared handler.
        context = (
            None
            if self._context_handler is None
            else Context.held(self._context_handler, request.selection())
        )
        shared = {"title": route["title"], "csrf": request.csrf_token()}
        if self._shared_handler is not None:
            handed = Page._loader_map(
                self._container.call(self._shared_handler, provided),
                "the shared handler",
            )
            if "context" in handed:
                raise ValueError("the shared handler returned the key context (HY-124)")
            shared.update(handed)

        changed = RegionPlanner.changed_topics(request, flash, base_path)
        data: dict[str, dict] = {}
        templates: dict[str, str] = {}
        for selected in RegionPlanner.select(
            self._manifest, not request.is_region_request(), changed
        ):
            if selected.page:
                loaded = (
                    Page._loader_map(
                        self._container.call(handler["load"], provided),
                        f"the loader of route {route['name']}",
                    )
                    if "load" in handler
                    else {}
                )
                data[selected.name] = {**loaded, **invalid}
                templates[selected.name] = route["template"]
                for route_region in route["regions"]:
                    loader = handler.get("regions", {}).get(route_region.name)
                    # HY-75.7: a route region without a loader is present with no data of its own.
                    region_data = (
                        {} if loader is None else self._container.call(loader, provided)
                    )
                    # HY-75: a route region loader that returns None makes the region absent from this response.
                    if region_data is None:
                        continue
                    data[route_region.name] = Page._loader_map(
                        region_data, f"the loader of region {route_region.name}"
                    )
                    templates[route_region.name] = route_region.template
            else:
                loader = self._region_loaders.get(selected.name)
                data[selected.name] = (
                    Page._loader_map(
                        self._container.call(loader, provided),
                        f"the loader of region {selected.name}",
                    )
                    if loader is not None
                    else {}
                )
                templates[selected.name] = selected.template

        # HY-44: every value that the handlers returned belongs to the data model, also a value that no template
        # reads.
        DataModel.check({"shared": shared, "regions": data})
        # HY-73: the page keeps only the paths that the templates of the route read.
        shared = self._reads.shared(route["name"], shared)
        for name, region_data in data.items():
            data[name] = self._reads.region(route["name"], name, region_data)
        kept = self._kept(request, session, data)
        # HY-69: the reply gives a page with status 200 the status 403.
        if status == 200 and reply._status_value() is not None:
            status = reply._status_value()
        vary = self._vary_text
        if json_request:
            value = JsonCodec.value(
                self._timezone,
                route["name"],
                request.params(),
                self._build,
                None
                if context is None
                else Context.member(
                    self._build, context, request.header("Hyper-Context")
                ),
                shared,
                data,
                kept,
            )
            # HY-44: the check above covered the handler data, and a kept value enters only when it belongs to the
            # data model, so only the parameters of the request are checked here.
            DataModel.check(request.params())
            body = JsonCodec.encode(value)
            headers = {
                "Content-Type": _JSON,
                "Cache-Control": (reply._cache_control_value() or "no-store")
                if status == 200
                else "no-store",
                "Vary": vary,
                **reply._referrer_policy_headers(),
            }
            if status != 200:
                return Response(status, headers, body)
            # HY-53: a weak tag of the body with the masked token replaced by the session token, so the mask does
            # not change it; a matching GET request receives 304 without a body and without `Content-Type`, because
            # a 304 carries no representation.
            tag = core().Page.tag(body, request.csrf_token(), session.csrf_token())
            headers["ETag"] = tag
            if request.method != "GET" or request.header("If-None-Match") != tag:
                return Response(200, headers, body)
            del headers["Content-Type"]
            return Response(304, headers, "")

        headers = {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": (reply._cache_control_value() or "no-store")
            if status == 200
            else "no-store",
            "Vary": vary,
            **reply._referrer_policy_headers(),
        }
        return Response(
            status,
            headers,
            self._document(
                request,
                route,
                shared,
                context,
                data,
                templates,
                kept,
                reply._embeds_data(),
            ),
        )

    @staticmethod
    def _loader_map(value: object, source: str) -> dict:
        """Returns the value that the shared handler or a loader returned when it is a map of the data model (HY-44).
        Another value fails with HY-43."""
        if not isinstance(value, dict):
            raise TypeError(f"{source} did not return a map")
        return value

    def _kept(self, request: Request, session: Session, data: dict) -> dict:
        """Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17,
        HY-38)."""
        # On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
        cookie = Page._decoded_cookie(
            request.cookie(
                "__Host-hy-keep" if self._https or request.https else "hy-keep"
            )
        )
        kept: dict[str, dict] = {}
        for name, region_data in data.items():
            region = self._manifest.region(name)
            if region is None:
                continue
            stored = session.kept(name)
            values = []
            for kept_path, kind in region.keep.items():
                if kind == "server":
                    source = stored
                elif kind == "cookie":
                    region_cookie = (
                        cookie.get(name) if isinstance(cookie, dict) else None
                    )
                    source = region_cookie if isinstance(region_cookie, dict) else {}
                else:
                    source = {}
                if kept_path in source:
                    values.append((kept_path, source[kept_path]))
            selected_kept = Kept.select(region_data, values)
            if selected_kept != {}:
                kept[name] = selected_kept
        return kept

    @staticmethod
    def _decoded_cookie(text: Optional[str]) -> object:
        """Returns the decoded hy-keep cookie, or None without a cookie and for a cookie that is not JSON (HY-42)."""
        if text is None:
            return None
        try:
            return JsonCodec.decode(text)
        except JsonDecodeError:
            return None

    def _document(
        self,
        request: Request,
        route: dict,
        shared: dict,
        context: Optional[dict],
        data: dict,
        templates: dict,
        kept: dict,
        embed: bool,
    ) -> str:
        """Renders the document with the kept values applied. When that fails, every region whose rendering alone
        fails with its kept values renders with its loader data, route regions first, and its kept values leave the
        embedded data (HY-31, HY-38). The document embeds its data only when `embed` is True (HY-92)."""
        # H10.4: each root of the document is bound once, and every render merges the bound roots (VAL-22).
        # HY-10, HY-124: the templates read the context in the shared data, in its place after csrf or title.
        bound_shared = self._renderer.bind(
            shared if context is None else Context.with_context(shared, context)
        )
        applied = {}
        for name, region_data in data.items():
            pairs = list(
                (path, value) for path, value in (kept.get(name) or {}).items()
            )
            applied[name] = self._renderer.bind(Kept.apply(region_data, pairs))
        try:
            return self._render_document(
                request,
                route,
                shared,
                context,
                bound_shared,
                data,
                applied,
                templates,
                kept,
                embed,
            )
        except Exception:  # HY-38: kept values come from the client and may break a template; without them the error is raised again
            if kept == {}:
                raise
        page = self._manifest.page.name
        route_regions = Page._present(route, data)
        others = [name for name in data if name not in route_regions and name != page]
        for name in [*route_regions, *others, page]:
            if name not in kept:
                continue
            try:
                define = {}
                if name == page:
                    for route_region in route_regions:
                        define[route_region] = {
                            "template": templates[route_region],
                            "data": applied[route_region],
                        }
                self._renderer.alone(
                    templates[name], bound_shared, applied[name], define
                )
            except Exception:  # noqa: BLE001 - HY-38: the region renders with its loader data, and a failure there is raised by the next render
                applied[name] = self._renderer.bind(data[name])
                del kept[name]
        return self._render_document(
            request,
            route,
            shared,
            context,
            bound_shared,
            data,
            applied,
            templates,
            kept,
            embed,
        )

    @staticmethod
    def _present(route: dict, data: dict) -> list[str]:
        """Returns the names of the route regions of a route that are present in the data (HY-75)."""
        return [region.name for region in route["regions"] if region.name in data]

    def _render_document(
        self,
        request: Request,
        route: dict,
        shared: dict,
        context: Optional[dict],
        bound_shared,
        data: dict,
        applied: dict,
        templates: dict,
        kept: dict,
        embed: bool,
    ) -> str:
        # HY-31, HY-75, HY-92: a document embeds its data only when the reply asks for it, and then only the present
        # route regions and their kept entries, the data that the browser can change; a response without a present
        # route region embeds none. The embedded data is one more root, bound once (H10.4).
        route_region_names = Page._present(route, data)
        response = None
        if embed and route_region_names != []:
            embedded = {name: data[name] for name in route_region_names}
            response = JsonCodec.value(
                self._timezone,
                route["name"],
                request.params(),
                self._build,
                None if context is None else Context.member(self._build, context, None),
                shared,
                embedded,
                {name: kept[name] for name in embedded if name in kept},
            )
        regions = {}
        route_regions = {}
        for name, region_data in applied.items():
            region = {"template": templates[name], "data": region_data}
            if name in route_region_names:
                route_regions[name] = region
            else:
                regions[name] = region
        return self._renderer.document(
            self._manifest.layout,
            self._manifest.title,
            bound_shared,
            regions,
            self._manifest.page.name,
            route_regions,
            None if response is None else self._renderer.bind({"response": response}),
            self._build,
        )
