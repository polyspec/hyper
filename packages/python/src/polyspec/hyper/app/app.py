"""Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to
HY-27, HY-40, HY-42 to HY-46, HY-50 to HY-62, HY-65 to HY-67), with the rules of the PHP server."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from collections.abc import Sequence
from typing import Callable, Optional, Union

from ..representation._invalid_accept import InvalidAccept
from ..page.choice import Choice
from ..page.client_rendering import ClientRendering
from .container import Container
from ._build import Build
from ..representation._representation_entries import RepresentationEntries
from ._context import Context
from ._core import core
from ..session._csrf import Csrf
from ..data._json_codec import JsonCodec
from ..data._json_decode_error import JsonDecodeError
from ..representation._media_selection import MediaSelection
from ..representation._representation_entry import RepresentationEntry
from ..representation._representation_response import RepresentationResponse
from ..representation.media_type import MediaType
from ..page._manifest import Manifest
from ..page._page import Page
from ..page._region import Region
from ..http.reply import Reply
from ..http.request import Request
from ..http.response import Response
from ..result.bad_request import BadRequest
from ..result.forbidden import Forbidden
from ..result.not_found import NotFound
from ..result.redirect import Redirect
from ..result.result import Result
from ..page._router import Router
from ..session._flash import Flash
from ..session._session import Session
from ..session.session_store import SessionStore
from ._warnings_guard import WarningsGuard

_FORM_TYPES = ("application/x-www-form-urlencoded", "multipart/form-data")
_KEEP_VALUE_LIMIT = 4096
# HY-116: the types that a request without a client rendering selection can select, in the order of the ties.
_TEXT_HTML = "text/html"
_JSON = "application/vnd.hyper+json"
_PAGE_TYPES = (_TEXT_HTML, _JSON)


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
        client: Optional[ClientRendering],
        on_disconnect: Optional[Callable],
        shell: str,
        context: Optional[Callable],
        functions: Optional[dict],
        program: str,
    ):
        self.manifest = manifest
        self.base_path = base_path
        self.https = https
        self.frame_ancestors = frame_ancestors
        self.body_limit = body_limit
        self.file_limit = file_limit
        self._value_limit = value_limit
        self._part_limit = part_limit
        self._route_handlers = route_handlers
        self._response_limit = response_limit
        self._form_types = form_types
        self._on_response = on_response
        self._on_disconnect = on_disconnect
        self._client = client
        self._shell = shell
        self._context_handler = context
        self.container = Container()
        from ..page._renderer import Renderer

        renderer = Renderer.open(program, timezone, functions)
        # HY-125: the build id of the program directory, read when the application opens.
        build = Build.read(str(Path(program) / "build.json"))
        from ..page._reads import Reads

        self._page = Page(
            manifest,
            shared,
            region_loaders,
            self.container,
            renderer,
            Reads.open(program),
            build,
            timezone,
            https,
            context,
            self._vary_header(),
        )

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
        client_rendering: Optional[ClientRendering] = None,
        on_disconnect: Optional[Callable] = None,
        context: Optional[Callable] = None,
        functions: Optional[dict] = None,
    ) -> "App":
        """Creates an application from its manifest, the server program that `hyper build` of
        `@polyspec/hyper-cli` built from its templates (HY-48) and the handlers that load data and run actions.

        The body limit is the largest request body in bytes, and the form types are the media types of the request
        bodies that actions and `/_hyper/keep` accept (HY-59). The response limit is the largest response body in
        bytes that the server sends (HY-66). `on_response` is called once for every response with the request, the
        response, the elapsed milliseconds, the reply of the request, which is empty when the server answered
        before routing, and the failure of a 500 of HY-43 or HY-66, else None (HY-60). `on_disconnect` is called once
        with the request, the elapsed milliseconds and the reply of a request whose response the server of
        `create_server` of `polyspec.hyper` could not write because the client closed the connection (HY-67)."""
        # A limit is an integer (HY-59.2, HY-114.6, HY-131.10, HY-66.1); a boolean is an int of Python and no limit.
        if type(body_limit) is not int or body_limit < 1:
            raise ValueError(
                f"body limit {body_limit} is not a positive number of bytes"
            )
        if file_limit is None:
            file_limit = min(8 * 1024 * 1024, body_limit)
        if type(file_limit) is not int or file_limit < 1 or file_limit > body_limit:
            raise ValueError(
                f"file limit {file_limit} is not a positive number of bytes no larger than the body limit {body_limit} (HY-114)"
            )
        if value_limit is None:
            value_limit = min(8 * 1024 * 1024, body_limit)
        if type(value_limit) is not int or value_limit < 1 or value_limit > body_limit:
            raise ValueError(
                f"value limit {value_limit} is not a positive number of bytes no larger than the body limit {body_limit} (HY-131)"
            )
        if type(part_limit) is not int or part_limit < 1:
            raise ValueError(
                f"part limit {part_limit} is not a positive number (HY-131)"
            )
        if type(response_limit) is not int or response_limit < 1:
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
            raise ValueError("the disconnect hook is not callable (HY-67)")
        declared = Manifest.from_file(manifest)
        App._check_handlers(declared, handlers)
        shell = (
            ""
            if client_rendering is None
            else App._checked_shell(client_rendering, declared)
        )

        return App(
            declared,
            handlers.get("shared"),
            handlers.get("regions", {}),
            handlers.get("routes", {}),
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
            client_rendering,
            on_disconnect,
            shell,
            context,
            functions,
            program,
        )

    @staticmethod
    def _checked_shell(client: ClientRendering, manifest: Manifest) -> str:
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
        except OSError:
            raise ValueError(
                f"static shell {client.shell} is not a readable file at an absolute path"
            ) from None
        except UnicodeDecodeError as error:
            raise ValueError(
                f"static shell {client.shell} is not valid UTF-8: {error}"
            ) from None
        # The base path is escaped as PHP `htmlspecialchars` with `ENT_QUOTES` escapes it.
        escaped = (
            base.replace("&", "&amp;")
            .replace('"', "&quot;")
            .replace("'", "&#039;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        if f'<meta name="hyper-api" content="{escaped}">' not in shell:
            raise ValueError(
                f"static shell {client.shell} does not declare the data base path {base}"
            )
        return shell

    @staticmethod
    def _check_handlers(manifest: Manifest, handlers: dict) -> None:
        """Fails for a handler that the manifest does not declare, and for a route whose declaration has no handler:
        the region loaders, the route handlers with their POST action and their route regions, and the representation
        handlers of each route (HY-120)."""
        region_loaders = handlers.get("regions", {})
        for name in region_loaders:
            region: Optional[Region] = next(
                (entry for entry in manifest.regions if entry.name == name), None
            )
            if region is None or region.page:
                raise ValueError(
                    f"region loader {name} has no non-page region in the manifest"
                )
        route_handlers = handlers.get("routes", {})
        for name, handler in route_handlers.items():
            if name not in manifest.routes:
                raise ValueError(f"route handler {name} has no route in the manifest")
            if ("post" in handler) != manifest.routes[name]["post"]:
                raise ValueError(
                    f"route {name} must have a POST action exactly when the manifest declares post"
                )
            route_regions = [region.name for region in manifest.routes[name]["regions"]]
            for region_name in handler.get("regions", {}):
                if region_name not in route_regions:
                    raise ValueError(
                        f"route {name} has a loader for undeclared region {region_name}"
                    )
        for name, route in manifest.routes.items():
            if route["post"] and "post" not in route_handlers.get(name, {}):
                raise ValueError(f"route {name} declares post but has no POST action")
            RepresentationEntries.check_handlers(
                name,
                route["representations"],
                route_handlers.get(name, {}).get("representations", {}),
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
            response = WarningsGuard.run(lambda: self._dispatch(request, store, reply))
        except Exception as error:  # noqa: BLE001 - HY-43: every error of the application answers a plain 500
            failure = self._log_failure(error)
            response = Response.text(500, "Internal Server Error")
        size = len(response.body.encode("utf-8"))
        if size > self._response_limit:
            failure = (
                f"the response to {request.method} {request.path()} has {size} bytes, "
                f"more than the response limit of {self._response_limit} bytes"
            )
            print(f"hyper: {failure}", file=sys.stderr)
            response = Response.text(500, "Internal Server Error")

        response = self._frame(response)
        self._report(request, response, started, reply, failure)
        return response, reply

    def _disconnected(self, request: Request, started: int, reply: Reply) -> None:
        """Reports a request whose response could not be written because the client closed the connection to
        `on_disconnect`, with the milliseconds since `started`, a `perf_counter_ns` value (HY-67)."""
        if self._on_disconnect is not None:
            self._on_disconnect(
                request, (time.perf_counter_ns() - started) / 1e6, reply
            )

    def _report(
        self,
        request: Request,
        response: Response,
        started: int,
        reply: Reply,
        failure: Optional[str],
    ) -> None:
        """Calls the response hook with a response, the milliseconds since `started`, the reply of the request and the
        failure of a 500 of HY-43 or HY-66, else None (HY-60)."""
        if self._on_response is not None:
            self._on_response(
                request,
                response,
                (time.perf_counter_ns() - started) / 1e6,
                reply,
                failure,
            )

    def _frame(self, response: Response) -> Response:
        """Adds the frame-ancestors policy of the application to a response (HY-45), and no-store to a failure
        (HY-65)."""
        response = response.with_header(
            "Content-Security-Policy", f"frame-ancestors {self.frame_ancestors}"
        )
        if response.status >= 400:
            response = response.with_header("Cache-Control", "no-store")
        return response

    def _log_failure(self, error: BaseException) -> str:
        """Writes the log line of an unhandled error (HY-43) and returns its failure, the message of the error, which
        the hooks receive (HY-60, HY-99)."""
        print(f"hyper: {type(error).__name__}: {error}", file=sys.stderr)
        return str(error)

    def _dispatch(
        self, request: Request, store: SessionStore, reply: Reply
    ) -> Response:
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
            return self._dispatch(request._as_get(), store, reply)
        choice = self._client_choice(request)
        client = self._client if choice is not None and choice.chosen is True else None
        request = request._with_selection(None if choice is None else choice.value)
        base_path = self.base_path if client is None else client.base_path
        path = Router.strip_base_path(request.path(), base_path)
        if client is not None and path is None:
            return self._shell_response(request)
        if path == "/_hyper/keep":
            return self._store_kept(request, Session(store))
        match = None if path is None else self.manifest.router.match(path)
        if match is None:
            return Response.text(404, "Not Found")
        route = self.manifest.routes[match["name"]]
        handler = self._route_handlers.get(route["name"], {})
        entries = route["representations"]
        if client is not None:
            # HY-62 step 2: the data base path serves the JSON type and the representations of the route (HY-116.14),
            # and the method check follows the selection.
            selected = App._negotiate(request, (_JSON,), entries)
            if isinstance(selected, Response):
                return selected
        else:
            selected = App._negotiate(request, _PAGE_TYPES, entries)
            if isinstance(selected, Response):
                return selected
        chosen, entry, values = selected
        if entry is not None:
            # HY-120, HY-121: a representation request opens no session and runs only its handler.
            return self._answer_representation(
                request._with_route(path, match["params"]),
                handler,
                entry,
                values,
                base_path,
            )
        # HY-120: the session opens after the method check and the context header check, which refuse the request
        # first. HY-116.12: the method check.
        if request.method != "GET" and (
            request.method != "POST" or "post" not in handler
        ):
            return App._not_allowed(
                "GET, HEAD, POST" if "post" in handler else "GET, HEAD"
            )
        # HY-62.20: the data base path answers no page, after the method check of HY-116.
        if client is not None and chosen == _TEXT_HTML:
            return App._not_acceptable()
        # HY-127: an application with a context checks the Hyper-Context header after the method check.
        if self._context_handler is not None and not Context.valid_header(
            request.header("Hyper-Context")
        ):
            return Response.text(400, "Bad Request")
        request = request._with_media(chosen)
        session = Session(store)
        flash = session.take_flash()
        request = request._with_route(path, match["params"])._with_session(
            flash, Csrf.masked(session.csrf_token())
        )

        return self._routed(
            request, route, handler, session, flash, reply, base_path
        )._with_cookies(reply, self.https or request.https)

    def _client_choice(self, request: Request) -> Optional[Choice]:
        """Returns the choice of the client rendering selection for the request, or None without client rendering
        (HY-62)."""
        if self._client is None:
            return None
        choice = self._client.selects(request)
        # HY-62.36: a choice whose `chosen` is not a boolean is another value.
        if not isinstance(choice, Choice) or not isinstance(choice.chosen, bool):
            raise TypeError(
                "the selection of the client rendering did not return a Choice"
                " whose chosen is a boolean"
            )
        return choice

    def _shell_response(self, request: Request) -> Response:
        """Answers a client-rendered request outside the data base path: the static shell for a page (HY-62)."""
        match = self.manifest.router.match(request.path())
        if match is None:
            return Response.text(404, "Not Found")
        if request.method != "GET":
            return App._not_allowed("GET, HEAD")
        # HY-62 step 3: the static shell is the only page of this path, and it serves only text/html. The
        # representations of the route take part in the selection, so that a request that selects one of them is not
        # acceptable here, and they are not listed (HY-116.14).
        entries = self.manifest.routes[match["name"]]["representations"]
        try:
            chosen = MediaSelection.select(
                request.header("Accept"), _PAGE_TYPES, entries
            )
        except InvalidAccept:
            return Response.text(400, "Bad Request").with_header("Vary", "Accept")
        if chosen is None:
            return Response.text(
                406, MediaSelection.listing((_TEXT_HTML,), ())
            ).with_header("Vary", "Accept")
        if chosen[0] != _TEXT_HTML:
            return App._not_acceptable()
        return Response(
            200,
            {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-cache",
                "Vary": self._vary_header(),
            },
            self._shell,
        )

    def _vary_header(self) -> str:
        """Returns the `Vary` of a response that `Accept` and the context decide (HY-117.1). The core decides it."""
        return core().App.vary_header(self._context_handler is not None)

    @staticmethod
    def _negotiate(
        request: Request,
        served: tuple[str, ...],
        entries: Sequence[RepresentationEntry],
    ) -> Union[tuple[str, Optional[RepresentationEntry], dict[str, str]], Response]:
        """Selects the media type of a request among text/html, application/vnd.hyper+json and the representations
        of its route (HY-116), or returns the response that refuses it: 400 for an invalid `Accept`, and 406 with the
        served types for a request that matches none of them."""
        try:
            selected = MediaSelection.select(
                request.header("Accept"), _PAGE_TYPES, entries
            )
        except InvalidAccept:
            return Response.text(400, "Bad Request").with_header("Vary", "Accept")
        if selected is None:
            return Response.text(
                406, MediaSelection.listing(served, entries)
            ).with_header("Vary", "Accept")
        return selected

    def _answer_representation(
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
            return App._not_allowed(", ".join(answered)).with_header("Vary", vary)
        value = None
        if method in ("GET", "DELETE"):
            if request.body_size() != 0:
                return Response.text(400, "Bad Request").with_header("Vary", vary)
        else:
            if request.media_type() != "application/json":
                return Response.text(415, "Unsupported Media Type").with_header(
                    "Vary", vary
                )
            try:
                value = JsonCodec.decode(request._body_bytes().decode("utf-8"))
            except UnicodeDecodeError, JsonDecodeError:
                return Response.text(400, "Bad Request").with_header("Vary", vary)
            # HY-121.8: a number outside the data model is no value that a handler reads.
            if not JsonCodec.in_data_model(value):
                return Response.text(400, "Bad Request").with_header("Vary", vary)
        content_type = MediaSelection.content_type(entry, values)
        given = request._as_representation(value)
        media = MediaType(values, content_type)
        try:
            # The handler receives the request and the media type by parameter type, or by the parameter names
            # `request` and `media`, and the services that `bind` registered, as a loader does.
            returned = self.container.call(
                handler["representations"][entry.type],
                {Request: given, MediaType: media, "request": given, "media": media},
            )
        except Exception as error:
            code = App._orm_code(error)
            if code == "NO_ROWS":
                return Response.text(404, "Not Found").with_header("Vary", vary)
            if code == "REVISION_CHANGED":
                return Response.text(412, "Precondition Failed").with_header(
                    "Vary", vary
                )
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
            name: text
            for name, text in response.headers.items()
            if name != "Content-Type"
        }
        return Response(304, headers, "")

    @staticmethod
    def _not_allowed(allow: str) -> Response:
        """Returns the 405 of a method that a target does not take, with the methods that it takes (HY-27.6)."""
        return Response.text(405, "Method Not Allowed").with_header("Allow", allow)

    @staticmethod
    def _not_acceptable() -> Response:
        """Returns the 406 of HY-62 steps 2 and 3, which `Accept` decides."""
        return Response.text(406, "Not Acceptable").with_header("Vary", "Accept")

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
                return App._without_renewal(
                    reply,
                    self._page.respond(
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
            try:
                result = self.container.call(
                    handler["post"], {Request: request, Reply: reply}
                )
            except Exception as error:
                # HY-107.4: only the action that raises REVISION_CHANGED is answered as the page with status 409 and
                # no data of its own; a loader that raises it fails below (HY-43).
                if App._orm_code(error) != "REVISION_CHANGED":
                    raise
                result = Result.page(409, {})
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
                return self._redirect_response(session, result, base_path)
            # HY-72.4: a loader that renews the session fails, also while the 409 page renders.
            return App._without_renewal(
                reply,
                self._page.respond(
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
            return self._redirect_response(session, redirect.result, base_path)
        except Forbidden:
            return Response.text(403, "Forbidden")
        except BadRequest:
            return Response.text(400, "Bad Request")
        except Exception as error:
            # HY-107: an error of the ORM is answered as the stop of its meaning; every other error escapes (HY-43),
            # also REVISION_CHANGED of a loader (HY-107.4).
            if App._orm_code(error) == "NO_ROWS":
                return Response.text(404, "Not Found")
            raise

    @staticmethod
    def _orm_code(error: Exception) -> str | None:
        """The code of an error of the ORM, which hyper knows by the name of its class and by its attribute `code`, because
        it does not depend on the ORM (HY-107), or None for every other error."""
        code = getattr(error, "code", None)
        if type(error).__name__ != "OrmError" or not isinstance(code, str):
            return None
        return code

    @staticmethod
    def _without_renewal(reply: Reply, response: Response) -> Response:
        """Fails when a loader or the shared handler renewed the session, because the page carries the old token
        (HY-72)."""
        if reply._take_renewal():
            raise TypeError(
                "a loader or the shared handler called renewSession; only an action renews the session"
            )
        return response

    def _redirect_response(
        self, session: Session, result: Result, base_path: str
    ) -> Response:
        """Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50)."""
        session.put_flash(Flash(result._flash_values, result._changed_topics))
        return Response(303, {"Location": base_path + result.location}, "")

    def _refused_form(self, request: Request, session: Session) -> Optional[Response]:
        """Returns the response that refuses a form request of an unsupported media type or with a wrong CSRF token,
        or None."""
        if request.media_type() not in self._form_types:
            return Response.text(415, "Unsupported Media Type")
        if not Csrf.verify(session.csrf_token(), request.form_string("_csrf")):
            return Response.text(403, "Forbidden")
        return None

    def _store_kept(self, request: Request, session: Session) -> Response:
        """Stores a kept value of a `server` path in the session (HY-40)."""
        if request.method != "POST":
            return App._not_allowed("POST")
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
