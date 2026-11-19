"""Answers the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-31, HY-38, HY-44, HY-52, HY-53, HY-69,
HY-73, HY-75, HY-92, HY-124) with the steps of a page of the core: `PageRequest.next` names each handler, the server
calls it and gives its result to the next step, and the last step holds the document or the JSON text. The core
selects the regions, checks every value (HY-44), keeps the read paths (HY-73), applies the kept values (HY-38) and
renders; the server holds no rule of them. The app creates one page when it opens."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .._binding import _root as core
from ..app._context import Context
from ..app._core_rules import core_rules
from ..app.container import Container
from ..http.reply import Reply
from ..http.request import Request
from ..http.response import Response
from ..session._flash import Flash
from ..session._session import Session
from ._manifest import Manifest
from ._region_planner import RegionPlanner

# The depth past which `plain` converts no further map or list: the data model allows 64 levels (HY-44.11), so a value
# deeper than that fails in the core whatever lies below it.
_PLAIN_DEPTH = 66


@dataclass(frozen=True)
class PageAction:
    """The action of a request that answers its route page: its result, or None for an action that let
    `revision_changed` escape (HY-107.9), and the masked value of the token that the request held before the action,
    which differs from that of the request of the page after a renewal (HY-72.3)."""

    result: Optional[Any]
    masked: str


class Page:
    """The page rendering of one application: the pages of the core that the app opened, its manifest, its shared
    handler and its region loaders (HY-48)."""

    def __init__(
        self,
        pages: Any,
        manifest: Manifest,
        shared: Optional[Callable],
        region_loaders: dict,
        container: Container,
        https: bool,
        context: Optional[Callable],
    ):
        self._pages = pages
        self._manifest = manifest
        self._shared_handler = shared
        self._region_loaders = region_loaders
        self._container = container
        self._https = https
        self._context_handler = context

    def respond(
        self,
        request: Request,
        route: dict,
        handler: dict,
        session: Session,
        flash: Flash,
        action: Optional[PageAction],
        reply: Reply,
        base_path: str,
    ) -> Response:
        """Answers the page of a routed request. `action` is the action of a POST request that answers its page, or
        None for a GET request. `base_path` is the base path of the request: the data base path for a client-rendered
        request (HY-8, HY-62)."""
        provided = {Request: request, Reply: reply, "request": request, "reply": reply}
        # The masked value of the page input is that of before the action; the action step gives the new one (HY-72.3).
        masked = request.csrf_token()
        if request.wants_json():
            kind = (
                core.PageKind.REGION_JSON
                if request.is_region_request()
                else core.PageKind.DOCUMENT_JSON
            )
        else:
            kind = core.PageKind.HTML
        page = core.PageRequest(
            self._pages,
            route=route["name"],
            params=dict(request.params()),
            kind=kind,
            action=action is not None,
            csrf=masked if action is None else action.masked,
            changed=RegionPlanner.changed_topics(request, flash, base_path),
            # HY-14.3: one whole number of seconds for every render of the response.
            now=float(int(time.time())),
            # On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
            keep_cookie=request.cookie(
                core_rules().kept_cookie_name(self._https or request.https)
            ),
            held_hash=request.header("Hyper-Context"),
        )
        # The regions whose loader gave data, in the order of their calls; the session is read for these (HY-38.20).
        present: list[str] = []
        page_region = self._manifest.page.name
        step = page.next(core.PageStepInputStart())
        while isinstance(step, core.StepCall):
            call = step.call
            if isinstance(call, core.CallAction):
                if action is None:
                    raise RuntimeError(
                        "hyper: a page without an action asked for its action"
                    )
                csrf = None if masked == action.masked else masked
                outcome = (
                    core.ActionOutcomeRevisionChanged()
                    if action.result is None
                    else core.ActionOutcomePage(
                        status=action.result.status,
                        data=Page._loader_map(
                            action.result.data, f"the data of route {route['name']}"
                        ),
                    )
                )
                given: Any = core.PageStepInputAction(outcome=outcome, csrf=csrf)
            elif isinstance(call, core.CallContext):
                # HY-124: the context handler runs after the action of the request and before the shared handler.
                if self._context_handler is None:
                    raise RuntimeError(
                        "hyper: a page without a context handler asked for its context"
                    )
                given = core.PageStepInputContext(
                    context=Page._plain(
                        Context.held(self._context_handler, request.selection()), 0
                    )
                )
            elif isinstance(call, core.CallShared):
                given = (
                    core.PageStepInputNoHandler()
                    if self._shared_handler is None
                    else core.PageStepInputShared(
                        shared=Page._loader_map(
                            self._container.call(self._shared_handler, provided),
                            "the shared handler",
                        )
                    )
                )
            elif isinstance(call, core.CallRouteLoader):
                given = (
                    core.PageStepInputLoaded(
                        data=Page._loader_map(
                            self._container.call(handler["load"], provided),
                            f"the loader of route {route['name']}",
                        )
                    )
                    if "load" in handler
                    else core.PageStepInputNoHandler()
                )
                present.append(page_region)
            elif isinstance(call, core.CallRouteRegionLoader):
                loader = handler.get("regions", {}).get(call.region)
                if loader is None:
                    given = core.PageStepInputNoHandler()
                    present.append(call.region)
                else:
                    loaded = self._container.call(loader, provided)
                    # HY-75: a route region loader that returns None makes the region absent from this response.
                    if loaded is None:
                        given = core.PageStepInputAbsent()
                    else:
                        given = core.PageStepInputLoaded(
                            data=Page._loader_map(
                                loaded, f"the loader of region {call.region}"
                            )
                        )
                        present.append(call.region)
            elif isinstance(call, core.CallRegionLoader):
                loader = self._region_loaders.get(call.region)
                given = (
                    core.PageStepInputNoHandler()
                    if loader is None
                    else core.PageStepInputLoaded(
                        data=Page._loader_map(
                            self._container.call(loader, provided),
                            f"the loader of region {call.region}",
                        )
                    )
                )
                present.append(call.region)
            else:
                # HY-38.20: the stored kept values are read after every loader returned. HY-92, HY-69: the reply
                # states whether a document embeds its data and the status of a page with status 200.
                given = core.PageStepInputReply(
                    embeds=reply._embeds_data(),
                    stored={name: session.kept(name) for name in present},
                    status=reply._status_value(),
                )
            step = page.next(given)
        answer = step.answer
        if isinstance(answer, core.AnswerNoPage):
            raise RuntimeError("hyper: the page of a request answered no page")
        json, body, masked_token, token = Page._json(answer, masked, session)
        computed = core.compute_page_headers(
            status=answer.status,
            json=json,
            body=body,
            context=self._context_handler is not None,
            masked_token=masked_token,
            token=token,
            method=request.method,
            cache_control=reply._cache_control_value(),
            if_none_match=request.header("If-None-Match"),
            referrer_policy=reply._referrer_policy_value(),
        )
        return Response(
            computed.status,
            dict(computed.headers),
            body if computed.body else "",
        )

    @staticmethod
    def _json(answer: Any, masked: str, session: Session) -> tuple[bool, str, str, str]:
        """Returns whether the answer is JSON, its text, and the masked token and the token of the session that its tag
        takes. HY-53: only a JSON response with status 200 has a tag, which the core computes from the body with the
        masked token replaced by the token of the session; the session is read for no other response."""
        json = isinstance(answer, core.AnswerJson)
        body = answer.text if json else answer.html
        tagged = json and answer.status == 200
        return (
            json,
            body,
            masked if tagged else "",
            session.csrf_token() if tagged else "",
        )

    @staticmethod
    def _loader_map(value: object, source: str) -> dict:
        """Returns the result of a handler as the map that a step of the core takes (HY-44.4): a dictionary converted
        by `plain`; another value fails. The core checks the values of the map (HY-44.12). `source` names the data in
        the message."""
        if not isinstance(value, dict):
            raise TypeError(f"{source} did not return a map")
        return Page._plain(value, 0)

    @staticmethod
    def _plain(value: object, depth: int) -> Any:
        """Returns a value with every dictionary and list of the application, a subclass included, as a dictionary or
        a list of Python itself, read once each (HY-13.8): the binding converts only those, and a subclass is an object
        of the application to it (VAL-19). Every other value stays as it is, so the core judges it (HY-44). Below the
        depth that the data model allows, a value stays as it is, and the core fails it with its depth."""
        if depth > _PLAIN_DEPTH:
            return value
        if isinstance(value, dict):
            return {key: Page._plain(item, depth + 1) for key, item in value.items()}
        if isinstance(value, list):
            return [Page._plain(item, depth + 1) for item in value]
        return value
