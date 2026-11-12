"""Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to
HY-27, HY-40, HY-42 to HY-46, HY-50 to HY-62, HY-65 to HY-67), with the rules of the PHP server."""

from __future__ import annotations

import hashlib
import re
import sys
import time
from pathlib import Path
from collections.abc import Sequence
from typing import Callable, Optional, Union

from ._invalid_accept import InvalidAccept
from .choice import Choice
from .client_rendering import ClientRendering
from .container import Container
from ._build import Build
from ._representation_entries import RepresentationEntries
from ._context import Context
from ._csrf import Csrf
from ._data_model import DataModel
from ._json_codec import JsonCodec
from ._json_decode_error import JsonDecodeError
from ._kept import Kept
from ._media import JSON, TEXT_HTML
from ._media_selection import MediaSelection
from ._representation_entry import RepresentationEntry
from ._representation_response import RepresentationResponse
from .media_type import MediaType
from ._manifest import Manifest
from ._region_planner import RegionPlanner
from .reply import Reply
from .request import Request
from .response import Response
from .bad_request import BadRequest
from .forbidden import Forbidden
from .not_found import NotFound
from .redirect import Redirect
from .result import Result
from ._router import Router
from ._session import Flash, Session
from .session import SessionStore
from ._warnings_guard import WarningsGuard

_FORM_TYPES = ("application/x-www-form-urlencoded", "multipart/form-data")
_COOKIE_KEPT = re.compile(r"[a-z][a-z0-9_-]*")
_KEEP_VALUE_LIMIT = 4096
# HY-116: the types that a request without a client rendering selection can select.
_PAGE_TYPES = (TEXT_HTML, JSON)


def _not_allowed(allow: str) -> Response:
    """Returns the 405 of a method that a target does not take, with the methods that it takes (HY-27.6)."""
    return Response.text(405, "Method Not Allowed").with_header("Allow", allow)


def _not_acceptable() -> Response:
    """Returns the 406 of HY-62 steps 2 and 3, which `Accept` decides."""
    return Response.text(406, "Not Acceptable").with_header("Vary", "Accept")


class App:
    """One application: its manifest, its handlers and its server program (HY-1, HY-48)."""

    def __init__(
        self,
        manifest: Manifest,
        shared: Optional[Callable],
        region_loaders: dict,
        route_handlers: dict,
        timezone: str,
        base_path: str,
        https: bool,
        frame_ancestors: str,
        body_limit: int,
        file_limit: int,
        value_limit: int,
        part_limit: int,
        response_limit: int,
        form_types: list[str],
        on_response: Optional[Callable],
        on_disconnect: Optional[Callable],
        client: Optional[ClientRendering],
        shell: str,
        program: str,
        context: Optional[Callable],
        functions: Optional[dict],
    ):
        self.manifest = manifest
        self.timezone = timezone
        self.base_path = base_path
        self.https = https
        self.frame_ancestors = frame_ancestors
        self.body_limit = body_limit
        self.file_limit = file_limit
        self._value_limit = value_limit
        self._part_limit = part_limit
        self._shared = shared
        self._region_loaders = region_loaders
        self._route_handlers = route_handlers
        self._response_limit = response_limit
        self._form_types = form_types
        self._on_response = on_response
        self._on_disconnect = on_disconnect
        self._client = client
        self._shell = shell
        self._context_handler = context
        self.container = Container()
        from ._renderer import Renderer

        self.renderer = Renderer.open(program, timezone, functions)
        # HY-125: the build id of the program directory, read when the application opens.
        self.build = Build.read(str(Path(program) / "build.json"))
        from ._reads import Reads

        self.reads = Reads.open(program)

    @staticmethod
    def open(
        manifest: str,
        program: str,
        handlers: dict,
        timezone: str,
        base_path: str = "",
        https: bool = False,
        frame_ancestors: str = "'self'",
        body_limit: int = 8 * 1024 * 1024,
        form_types: Optional[list[str]] = None,
        file_limit: Optional[int] = None,
        response_limit: int = 8 * 1024 * 1024,
        value_limit: Optional[int] = None,
        part_limit: int = 1000,
        on_response: Optional[Callable] = None,
        on_disconnect: Optional[Callable] = None,
        client_rendering: Optional[ClientRendering] = None,
        context: Optional[Callable] = None,
        functions: Optional[dict] = None,
    ) -> "App":
        """Creates an application from its manifest, the server program that `hyper-build-server` of
        `@polyspec/hyper-build` built from its templates (HY-48) and the handlers that load data and run actions.

        The body limit is the largest request body in bytes, and the form types are the media types of the request
        bodies that actions and `/_hyper/keep` accept (HY-59). The response limit is the largest response body in
        bytes that the server sends (HY-66). `on_response` is called once for every response with the request, the
        response, the elapsed milliseconds, the reply of the request, which is empty when the server answered
        before routing, and the failure of a 500 of HY-43 or HY-66, else None (HY-60). `on_disconnect` is called once
        with the request, the elapsed milliseconds and the reply of a request whose response the server of
        `polyspec.hyper.server` could not write because the client closed the connection (HY-67)."""
        if body_limit < 1:
            raise ValueError(
                f"body limit {body_limit} is not a positive number of bytes"
            )
        if file_limit is None:
            file_limit = min(8 * 1024 * 1024, body_limit)
        if file_limit < 1 or file_limit > body_limit:
            raise ValueError(
                f"file limit {file_limit} is not a positive number of bytes no larger than the body limit {body_limit} (HY-114)"
            )
        if value_limit is None:
            value_limit = min(8 * 1024 * 1024, body_limit)
        if value_limit < 1 or value_limit > body_limit:
            raise ValueError(
                f"value limit {value_limit} is not a positive number of bytes no larger than the body limit {body_limit} (HY-131)"
            )
        if part_limit < 1:
            raise ValueError(
                f"part limit {part_limit} is not a positive number (HY-131)"
            )
        if response_limit < 1:
            raise ValueError(
                f"response limit {response_limit} is not a positive number of bytes"
            )
        types = list(
            ["application/x-www-form-urlencoded"] if form_types is None else form_types
        )
        if (
            types == []
            or len(set(types)) != len(types)
            or any(kind not in _FORM_TYPES for kind in types)
        ):
            raise ValueError(
                "form types must be distinct values of application/x-www-form-urlencoded "
                "and multipart/form-data"
            )
        if base_path != "" and (
            not base_path.startswith("/") or base_path.endswith("/")
        ):
            raise ValueError(
                f"base path {base_path} must start with / and must not end with /"
            )
        if on_disconnect is not None and not callable(on_disconnect):
            raise ValueError("on_disconnect must be a callable or None")
        declared = Manifest.from_file(manifest)

        region_loaders = handlers.get("regions", {})
        for name in region_loaders:
            region = next(
                (entry for entry in declared.regions if entry.name == name), None
            )
            if region is None or region.page:
                raise ValueError(
                    f"region loader {name} has no non-page region in the manifest"
                )
        route_handlers = handlers.get("routes", {})
        for name, handler in route_handlers.items():
            if name not in declared.routes:
                raise ValueError(f"route handler {name} has no route in the manifest")
            if ("post" in handler) != declared.routes[name]["post"]:
                raise ValueError(
                    f"route {name} must have a POST action exactly when the manifest declares post"
                )
            route_regions = [region.name for region in declared.routes[name]["regions"]]
            for region_name in handler.get("regions", {}):
                if region_name not in route_regions:
                    raise ValueError(
                        f"route {name} has a loader for undeclared region {region_name}"
                    )
        for name, route in declared.routes.items():
            if route["post"] and "post" not in route_handlers.get(name, {}):
                raise ValueError(f"route {name} declares post but has no POST action")
            RepresentationEntries.check_handlers(
                name,
                route["representations"],
                route_handlers.get(name, {}).get("representations", {}),
            )

        shell = "" if client_rendering is None else _shell(client_rendering, declared)

        return App(
            declared,
            handlers.get("shared"),
            region_loaders,
            route_handlers,
            timezone,
            base_path,
            https,
            frame_ancestors,
            body_limit,
            file_limit,
            value_limit,
            part_limit,
            response_limit,
            types,
            on_response,
            on_disconnect,
            client_rendering,
            shell,
            program,
            context,
            functions,
        )

    def bind(self, cls: type, factory: Callable) -> None:
        """Registers the factory of an application service."""
        self.container.bind(cls, factory)

    def handle(
        self, request: Request, store: SessionStore, started: Optional[int] = None
    ) -> Response:
        """Answers one request; an unhandled exception and a body larger than the response limit give a plain 500
        and are logged (HY-43, HY-66). Every response limits framing (HY-45), every failure is not cacheable
        (HY-65), and every response is reported to `on_response` with the milliseconds since `started`, a
        `perf_counter_ns` value of the monotonic clock that defaults to now (HY-60)."""
        return self._respond(request, store, started)[0]

    def _respond(
        self, request: Request, store: SessionStore, started: Optional[int] = None
    ) -> tuple[Response, Reply]:
        """Answers one request as `handle` does and returns the response with the reply of the request, which the
        server passes to `disconnected` when it cannot write the response (HY-67)."""
        if started is None:
            started = time.perf_counter_ns()
        reply = Reply()
        # The failure of a 500 of HY-43 or HY-66, which the hook receives (HY-60).
        failure = None
        try:
            # HY-74: a warning of the runtime fails the request instead of leaving a wrong page with status 200.
            response = WarningsGuard.run(lambda: self._answer(request, store, reply))
        except Exception as error:  # noqa: BLE001 - HY-43: every error of the application answers a plain 500
            print(f"hyper: {type(error).__name__}: {error}", file=sys.stderr)
            failure = str(error)
            response = Response.text(500, "Internal Server Error")
        size = len(response.body.encode("utf-8"))
        if size > self._response_limit:
            failure = (
                f"the response to {request.method} {request.path()} has {size} bytes, "
                f"more than the response limit of {self._response_limit} bytes"
            )
            print(f"hyper: {failure}", file=sys.stderr)
            response = Response.text(500, "Internal Server Error")

        response = response.with_header(
            "Content-Security-Policy", f"frame-ancestors {self.frame_ancestors}"
        )
        if response.status >= 400:
            response = response.with_header("Cache-Control", "no-store")
        if self._on_response is not None:
            self._on_response(
                request,
                response,
                (time.perf_counter_ns() - started) / 1e6,
                reply,
                failure,
            )
        return response, reply

    def _disconnected(self, request: Request, started: int, reply: Reply) -> None:
        """Reports a request whose response could not be written because the client closed the connection to
        `on_disconnect`, with the milliseconds since `started`, a `perf_counter_ns` value (HY-67)."""
        if self._on_disconnect is not None:
            self._on_disconnect(
                request, (time.perf_counter_ns() - started) / 1e6, reply
            )

    def _answer(self, request: Request, store: SessionStore, reply: Reply) -> Response:
        """Answers a request; the loaders and actions of a routed request receive `reply` (HY-52, HY-60)."""
        # HY-131.11: a body that passed the value limit, the part limit or the file limit is answered as a body over
        # the body limit.
        if request.body_size() > self.body_limit or request._exceeded(
            self._value_limit,
            self._part_limit,
            self.file_limit,
            "multipart/form-data" in self._form_types,
        ):
            return Response.text(413, "Content Too Large")
        if not request.valid_input():
            return Response.text(400, "Bad Request")
        # HY-27.4: a HEAD request is answered as the GET request of its target.
        if request.method == "HEAD":
            return self._answer(request._as_get(), store, reply)
        choice = self._choice(request)
        client = self._client if choice is not None and choice.chosen is True else None
        request = request._with_selection(None if choice is None else choice.value)
        base_path = self.base_path if client is None else client.base_path
        path = Router.strip_base_path(request.path(), base_path)
        if client is not None and path is None:
            return self._shell_response(request)
        if path == "/_hyper/keep":
            return self._keep(request, Session(store))
        match = None if path is None else self.manifest.router.match(path)
        if match is None:
            return Response.text(404, "Not Found")
        route = self.manifest.routes[match["name"]]
        handler = self._route_handlers.get(route["name"], {})
        entries = route["representations"]
        if client is not None:
            # HY-62 step 2: the data base path serves the JSON type and the representations of the route (HY-116.14),
            # and the method check follows the selection.
            selected = self._negotiate(request, (JSON,), entries)
            if isinstance(selected, Response):
                return selected
            if selected[0] == TEXT_HTML:
                return _not_acceptable()
        else:
            selected = self._negotiate(request, _PAGE_TYPES, entries)
            if isinstance(selected, Response):
                return selected
        chosen, entry, values = selected
        if entry is not None:
            # HY-120, HY-121: a representation request opens no session and runs only its handler.
            return self._representation(
                request._with_route(path, match["params"]),
                handler,
                entry,
                values,
                base_path,
            )
        # HY-120: the session opens after the method check and the context header check, which refuse the request first.
        refused = self._refused_before_session(request, handler)
        if refused is not None:
            return refused
        request = request._with_media(chosen)
        session = Session(store)
        flash = session.take_flash()
        request = request._with_route(path, match["params"])._with_session(
            flash, Csrf.masked(session.csrf_token())
        )

        return self._routed(
            request, route, handler, session, flash, reply, base_path
        )._with_cookies(reply, self.https or request.https)

    def _negotiate(
        self, request: Request, served: tuple[str, ...], entries: Sequence[RepresentationEntry]
    ) -> Union[tuple[str, Optional[RepresentationEntry], dict[str, str]], Response]:
        """Selects the media type of a request among text/html, application/vnd.hyper+json and the representations
        of its route (HY-116), or returns the response that refuses it: 400 for an invalid `Accept`, and 406 with the
        served types for a request that matches none of them."""
        try:
            selected = MediaSelection.select(request.header("Accept"), _PAGE_TYPES, entries)
        except InvalidAccept:
            return Response.text(400, "Bad Request").with_header("Vary", "Accept")
        if selected is None:
            return Response.text(406, MediaSelection.listing(served, entries)).with_header(
                "Vary", "Accept"
            )
        return selected

    def _representation(
        self,
        request: Request,
        handler: dict,
        entry: RepresentationEntry,
        values: dict[str, str],
        base_path: str,
    ) -> Response:
        """Answers a representation request (HY-121, HY-122): the method check, the body checks, the handler of the
        entry, and the response of what it returned with its tag."""
        vary = ", ".join(("Accept", *entry.vary))
        method = request.method
        if method not in entry.methods:
            # HY-121.6: an entry with GET also answers HEAD, which reaches here as GET (HY-27.4).
            answered = [
                name
                for name in ("GET", "HEAD", "POST", "PUT", "DELETE")
                if ("GET" if name == "HEAD" else name) in entry.methods
            ]
            return _not_allowed(", ".join(answered)).with_header("Vary", vary)
        value = None
        if method in ("GET", "DELETE"):
            if request.body_size() != 0:
                return Response.text(400, "Bad Request").with_header("Vary", vary)
        else:
            if request.media_type() != "application/json":
                return Response.text(415, "Unsupported Media Type").with_header("Vary", vary)
            try:
                value = JsonCodec.decode(request._body_bytes().decode("utf-8"))
            except (UnicodeDecodeError, JsonDecodeError):
                return Response.text(400, "Bad Request").with_header("Vary", vary)
            # HY-121.8: a number outside the data model is no value that a handler reads.
            if not JsonCodec.in_data_model(value):
                return Response.text(400, "Bad Request").with_header("Vary", vary)
        content_type = MediaSelection.content_type(entry, values)
        given = request._as_representation(value)
        try:
            returned = handler["representations"][entry.type](
                given, MediaType(values, content_type)
            )
        except Exception as error:
            code = _orm_code(error)
            if code == "NO_ROWS":
                return Response.text(404, "Not Found").with_header("Vary", vary)
            if code == "REVISION_CHANGED":
                return Response.text(412, "Precondition Failed").with_header("Vary", vary)
            raise
        response = RepresentationResponse.of(
            returned,
            content_type,
            vary,
            request.header("Authorization") is not None,
            base_path,
        )
        if response.status != 200 or method != "GET":
            return response
        # HY-122.10: a 200 of a GET, as which a HEAD is answered, has a strong tag, and a request that names it receives 304.
        tag = RepresentationResponse.etag(content_type, response.body)
        response = response.with_header("ETag", tag)
        if request.header("If-None-Match") != tag:
            return response
        headers = {
            name: text for name, text in response.headers.items() if name != "Content-Type"
        }
        return Response(304, headers, "")

    def _choice(self, request: Request) -> Optional[Choice]:
        """Returns the choice of the client rendering selection for the request, or None without client rendering
        (HY-62)."""
        if self._client is None:
            return None
        choice = self._client.selects(request)
        if not isinstance(choice, Choice):
            raise TypeError(
                "the selection of the client rendering did not return a Choice"
            )
        return choice

    def _shell_response(self, request: Request) -> Response:
        """Answers a client-rendered request outside the data base path: the static shell for a page (HY-62)."""
        match = self.manifest.router.match(request.path())
        if match is None:
            return Response.text(404, "Not Found")
        if request.method != "GET":
            return _not_allowed("GET, HEAD")
        # HY-62 step 3: the static shell is the only page of this path, and it serves only text/html. The
        # representations of the route take part in the selection, so that a request that selects one of them is not
        # acceptable here, and they are not listed (HY-116.14).
        entries = self.manifest.routes[match["name"]]["representations"]
        try:
            chosen = MediaSelection.select(request.header("Accept"), _PAGE_TYPES, entries)
        except InvalidAccept:
            return Response.text(400, "Bad Request").with_header("Vary", "Accept")
        if chosen is None:
            return Response.text(406, MediaSelection.listing((TEXT_HTML,), ())).with_header(
                "Vary", "Accept"
            )
        if chosen[0] != TEXT_HTML:
            return _not_acceptable()
        return Response(
            200,
            {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-cache",
                "Vary": self._vary,
            },
            self._shell,
        )

    def _refused_before_session(
        self, request: Request, handler: dict
    ) -> Optional[Response]:
        """Returns the refusal of the method check (HY-62 step 3) and of the context header (HY-127) of a request, or
        None. The application makes both checks before it opens the session (HY-120)."""
        if request.method != "GET" and (
            request.method != "POST" or "post" not in handler
        ):
            return _not_allowed("GET, HEAD, POST" if "post" in handler else "GET, HEAD")
        # HY-127: an application with a context checks the Hyper-Context header after the method check.
        if self._context_handler is not None and not Context.valid_header(
            request.header("Hyper-Context")
        ):
            return Response.text(400, "Bad Request")
        return None

    def _routed(
        self,
        request: Request,
        route: dict,
        handler: dict,
        session: Session,
        flash: Flash,
        reply: Reply,
        base_path: str,
    ) -> Response:
        """Answers a routed request with its page, action result or stop result."""
        try:
            if request.method == "GET":
                return _without_renewal(
                    reply,
                    self._page(
                        request,
                        route,
                        handler,
                        session,
                        flash,
                        200,
                        {},
                        reply,
                        base_path,
                    ),
                )
            refused = self._refused_form(request, session)
            if refused is not None:
                return refused
            # HY-114: a file over the file limit is refused before the action runs, as HY-59 refuses a large body.
            if request.file_over(self.file_limit):
                return Response.text(413, "Content Too Large")
            result = self.container.call(
                handler["post"], {Request: request, Reply: reply}
            )
            if not isinstance(result, Result):
                raise TypeError(
                    f"POST action of route {route['name']} did not return a Result"
                )
            # HY-72: the action renews the session after it returns, and a page that it renders carries the new
            # token.
            if reply._take_renewal():
                session.renew()
                request = request._with_session(
                    flash, Csrf.masked(session.csrf_token())
                )
            if result._is_redirect():
                return self._redirect(session, result, base_path)
            return _without_renewal(
                reply,
                self._page(
                    request,
                    route,
                    handler,
                    session,
                    flash,
                    result.status,
                    result.data,
                    reply,
                    base_path,
                ),
            )
        except NotFound:
            return Response.text(404, "Not Found")
        except Redirect as redirect:
            return self._redirect(session, redirect.result, base_path)
        except Forbidden:
            return Response.text(403, "Forbidden")
        except BadRequest:
            return Response.text(400, "Bad Request")
        except Exception as error:
            # HY-107: an error of the ORM is answered as the stop of its meaning; every other error escapes (HY-43).
            code = _orm_code(error)
            if code == "NO_ROWS":
                return Response.text(404, "Not Found")
            if code == "REVISION_CHANGED" and request.method == "POST":
                return self._page(
                    request, route, handler, session, flash, 409, {}, reply, base_path
                )
            raise

    def _redirect(self, session: Session, result: Result, base_path: str) -> Response:
        """Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50)."""
        session.put_flash(Flash(result._flash_values, result._changed_topics))
        return Response(303, {"Location": base_path + result.location}, "")

    def _page(
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
        if self._shared is not None:
            handed = _loader_map(
                self.container.call(self._shared, provided), "the shared handler"
            )
            if "context" in handed:
                raise ValueError("the shared handler returned the key context (HY-124)")
            shared.update(handed)

        changed = RegionPlanner.changed_topics(request, flash, base_path)
        data: dict[str, dict] = {}
        templates: dict[str, str] = {}
        for selected in RegionPlanner.select(
            self.manifest, not request.is_region_request(), changed
        ):
            if selected.page:
                loaded = (
                    _loader_map(
                        self.container.call(handler["load"], provided),
                        f"the loader of route {route['name']}",
                    )
                    if "load" in handler
                    else {}
                )
                data[selected.name] = {**loaded, **invalid}
                templates[selected.name] = route["template"]
                for route_region in route["regions"]:
                    loader = handler.get("regions", {}).get(route_region.name)
                    region_data = (
                        None
                        if loader is None
                        else self.container.call(loader, provided)
                    )
                    # HY-75: a route region loader that returns None makes the region absent from this response.
                    if region_data is None:
                        continue
                    data[route_region.name] = _loader_map(
                        region_data, f"the loader of region {route_region.name}"
                    )
                    templates[route_region.name] = route_region.template
            else:
                loader = self._region_loaders.get(selected.name)
                data[selected.name] = (
                    _loader_map(
                        self.container.call(loader, provided),
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
        shared = self.reads.shared(route["name"], shared)
        for name, region_data in data.items():
            data[name] = self.reads.region(route["name"], name, region_data)
        kept = self._kept(request, session, data)
        # HY-69: the reply gives a page with status 200 the status 403.
        if status == 200 and reply._status_value() is not None:
            status = reply._status_value()
        vary = self._vary
        if json_request:
            value = JsonCodec.value(
                self.timezone,
                route["name"],
                request.params(),
                self.build,
                None
                if context is None
                else Context.member(
                    self.build, context, request.header("Hyper-Context")
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
                "Content-Type": JSON,
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
            tag = (
                'W/"'
                + hashlib.sha256(
                    body.replace(request.csrf_token(), session.csrf_token()).encode(
                        "utf-8"
                    )
                ).hexdigest()[:32]
                + '"'
            )
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
                data,
                templates,
                kept,
                reply._embeds_data(),
                context,
            ),
        )

    @property
    def _vary(self) -> str:
        """The `Vary` of a response that `Accept` and the context decide (HY-117)."""
        if self._context_handler is None:
            return "Accept, HX-Request, HX-Current-URL"
        return "Accept, HX-Request, HX-Current-URL, Hyper-Context"

    def _kept(self, request: Request, session: Session, data: dict) -> dict:
        """Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17,
        HY-38)."""
        # On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
        cookie_text = (
            request.cookie(
                "__Host-hy-keep" if self.https or request.https else "hy-keep"
            )
            or ""
        )
        cookie = _decoded_cookie(cookie_text)
        kept: dict[str, dict] = {}
        for name, region_data in data.items():
            region = self.manifest.region(name)
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

    def _document(
        self,
        request: Request,
        route: dict,
        shared: dict,
        data: dict,
        templates: dict,
        kept: dict,
        embed: bool,
        context: Optional[dict],
    ) -> str:
        """Renders the document with the kept values applied. When that fails, every region whose rendering alone
        fails with its kept values renders with its loader data, route regions first, and its kept values leave the
        embedded data (HY-31, HY-38). The document embeds its data only when `embed` is True (HY-92)."""
        # H10.4: each root of the document is bound once, and every render merges the bound roots (VAL-22).
        # HY-10, HY-124: the templates read the context in the shared data, in its place after csrf or title.
        bound_shared = self.renderer.bind(
            shared if context is None else Context.with_context(shared, context)
        )
        applied = {}
        for name, region_data in data.items():
            pairs = list(
                (path, value) for path, value in (kept.get(name) or {}).items()
            )
            applied[name] = self.renderer.bind(Kept.apply(region_data, pairs))
        try:
            return self._render_document(
                request,
                route,
                shared,
                bound_shared,
                data,
                applied,
                templates,
                kept,
                embed,
                context,
            )
        except Exception:  # HY-38: kept values come from the client and may break a template; without them the error is raised again
            if kept == {}:
                raise
        page = self.manifest.page.name
        route_regions = _present(route, data)
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
                self.renderer.alone(
                    templates[name], bound_shared, applied[name], define
                )
            except Exception:  # noqa: BLE001 - HY-38: the region renders with its loader data, and a failure there is raised by the next render
                applied[name] = self.renderer.bind(data[name])
                del kept[name]
        return self._render_document(
            request,
            route,
            shared,
            bound_shared,
            data,
            applied,
            templates,
            kept,
            embed,
            context,
        )

    def _render_document(
        self,
        request: Request,
        route: dict,
        shared: dict,
        bound_shared,
        data: dict,
        applied: dict,
        templates: dict,
        kept: dict,
        embed: bool,
        context: Optional[dict],
    ) -> str:
        # HY-31, HY-75, HY-92: a document embeds its data only when the reply asks for it, and then only the present
        # route regions and their kept entries, the data that the browser can change; a response without a present
        # route region embeds none. The embedded data is one more root, bound once (H10.4).
        route_region_names = _present(route, data)
        response = None
        if embed and route_region_names != []:
            embedded = {name: data[name] for name in route_region_names}
            response = JsonCodec.value(
                self.timezone,
                route["name"],
                request.params(),
                self.build,
                None if context is None else Context.member(self.build, context, None),
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
        return self.renderer.document(
            self.manifest.layout,
            self.manifest.title,
            bound_shared,
            regions,
            self.manifest.page.name,
            route_regions,
            None if response is None else self.renderer.bind({"response": response}),
            self.build,
        )

    def _refused_form(self, request: Request, session: Session) -> Optional[Response]:
        """Returns the response that refuses a form request of an unsupported media type or with a wrong CSRF token,
        or None."""
        if request.media_type() not in self._form_types:
            return Response.text(415, "Unsupported Media Type")
        if not Csrf.verify(session.csrf_token(), request.form_string("_csrf")):
            return Response.text(403, "Forbidden")
        return None

    def _keep(self, request: Request, session: Session) -> Response:
        """Stores a kept value of a `server` path in the session (HY-40)."""
        if request.method != "POST":
            return _not_allowed("POST")
        refused = self._refused_form(request, session)
        if refused is not None:
            return refused
        if request.file_over(self.file_limit):
            return Response.text(413, "Content Too Large")
        name = request.form_string("region")
        path = request.form_string("path")
        region = self.manifest.region(name)
        if region is None or region.keep.get(path) != "server":
            return Response.text(400, "Bad Request")
        text = request.form_string("value")
        if len(text.encode("utf-8")) > _KEEP_VALUE_LIMIT:
            return Response.text(400, "Bad Request")
        try:
            decoded = JsonCodec.decode(text)
        except JsonDecodeError:
            return Response.text(400, "Bad Request")
        if not JsonCodec.in_data_model(decoded):
            return Response.text(400, "Bad Request")
        session.keep(name, path, decoded)
        return Response(204, {}, "")


def _loader_map(value: object, source: str) -> dict:
    """Returns the value that the shared handler or a loader returned when it is a map of the data model (HY-44).
    Another value fails with HY-43."""
    if not isinstance(value, dict):
        raise TypeError(f"{source} did not return a map")
    return value


def _shell(client: ClientRendering, manifest: Manifest) -> str:
    """Reads the static shell after checking the declaration of the client rendering against the manifest
    (HY-62)."""
    base = client.base_path
    if base == "" or not base.startswith("/") or base.endswith("/"):
        raise ValueError(
            f"data base path {base} must start with / and must not end with /"
        )
    for name, route in manifest.routes.items():
        if route["path"] == base or route["path"].startswith(base + "/"):
            raise ValueError(f"route {name} lies under the data base path {base}")
    shell_path = Path(client.shell)
    if not client.shell.startswith("/") or not shell_path.is_file():
        raise ValueError(
            f"static shell {client.shell} is not a readable file at an absolute path"
        )
    try:
        shell = shell_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(
            f"static shell {client.shell} is not valid UTF-8: {error}"
        ) from None
    if f'<meta name="hyper-api" content="{_escape_attribute(base)}">' not in shell:
        raise ValueError(
            f"static shell {client.shell} does not declare the data base path {base}"
        )
    return shell


def _escape_attribute(value: str) -> str:
    """Escapes a value as PHP `htmlspecialchars` with `ENT_QUOTES` does."""
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _orm_code(error: Exception) -> str | None:
    """The code of an error of the ORM, which hyper knows by the name of its class and by its attribute `code`, because
    it does not depend on the ORM (HY-107), or None for every other error."""
    code = getattr(error, "code", None)
    if type(error).__name__ != "OrmError" or not isinstance(code, str):
        return None
    return code


def _without_renewal(reply: Reply, response: Response) -> Response:
    """Fails when a loader or the shared handler renewed the session, because the page carries the old token
    (HY-72)."""
    if reply._take_renewal():
        raise TypeError(
            "a loader or the shared handler called renewSession; only an action renews the session"
        )
    return response


def _present(route: dict, data: dict) -> list[str]:
    """Returns the names of the route regions of a route that are present in the data (HY-75)."""
    return [region.name for region in route["regions"] if region.name in data]


def _decoded_cookie(text: str) -> object:
    """Returns the decoded hy-keep cookie, or None for a cookie that is not JSON (HY-42)."""
    try:
        return JsonCodec.decode(text)
    except JsonDecodeError:
        return None
