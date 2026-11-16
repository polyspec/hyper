"""The rules of the Rust core behind the names of the units of the Python server (HY-132.2). `CoreRules` takes the
module of the Python binding of the core, `polyspec.hyper._binding._root`, and gives each rule under the name of the
unit of the server that states it, so that a unit of the server calls the core in place of its own rule. The units of
the server reach one shared instance through `core_rules`, which imports the binding on its first call; a test gives
`CoreRules` a stand-in of that module.

A unit is exact when the core decides everything that the unit of the server decides, and partial when the server still
does a part itself; each partial unit names that part by its rule. The members of the binding that take a record
(`route_request`, `compute_page_headers`, `open_page`, `answer_keep_request`, `Pages` and `PageRequest`) have no unit
here.

A failure of the core reaches the caller as the binding raises it: an error of the class of its category with `kind`
and `status` (HY-132.1, HY-132.2). No function here catches or replaces one."""

from __future__ import annotations

from typing import Any, Optional

# The module of the binding that `core_rules` imports.
BINDING = "polyspec.hyper._binding._root"

# The members of the binding that this module calls, which `CoreRules` requires of the module that it receives.
_MEMBERS = (
    "csrf_mask",
    "csrf_verify",
    "browser",
    "stored_token",
    "is_application_path",
    "redirect_location",
    "cache_control",
    "keeps_out_of_shared_caches",
    "referrer_policy",
    "session_name",
    "keep_name",
    "session_cookie",
    "page_tag",
    "representation_tag",
    "media_type",
    "page_status",
    "reply_status",
    "page_vary",
    "context_hash",
    "current_path",
    "check_shell_path",
    "shell_text",
    "check_build_id",
    "read_build",
    "frame_headers",
    "kept_value",
    "valid_context_header",
    "json_read",
    "json_write",
    "flash_of",
    "kept_of",
    "kept_cookie",
    "accept_ranges",
)


class CoreRules:
    """The rules of the core under the names of the units of the server. A module that lacks a member of the binding
    fails here with its name, before a request calls it."""

    def __init__(self, core: Any) -> None:
        missing = [name for name in _MEMBERS if not callable(getattr(core, name, None))]
        if missing:
            raise RuntimeError(
                f"hyper: the binding of the core has no member {', '.join(missing)}"
            )
        self._core = core

    def csrf_mask(self, token: str, mask: str) -> str:
        """Csrf.mask: rules.csrf_mask (HY-24.2, HY-24.14)."""
        return self._core.csrf_mask(token, mask)

    def csrf_verify(self, token: str, value: str) -> bool:
        """Csrf.verify: rules.csrf_verify (HY-24.4)."""
        return self._core.csrf_verify(token, value)

    def csrf_browser_of(self, masked: str) -> Optional[str]:
        """Csrf.browser_of: rules.browser (HY-24.10, HY-24.13)."""
        return self._core.browser(masked)

    def context_hash(self, build: str, text: str) -> str:
        """Context.hash: rules.context_hash (HY-125.12)."""
        return self._core.context_hash(build, text)

    def context_valid_header(self, value: Optional[str]) -> bool:
        """Context.valid_header: rules.valid_context_header (HY-127.2)."""
        return self._core.valid_context_header(value)

    def json_codec_decode(self, text: str) -> object:
        """JsonCodec.decode: rules.json_read of the UTF-8 bytes of the text gives a value of the data model with
        dictionaries in document order, and fails with `malformed_json` or the kind of the data model (HY-54.20,
        HY-54.21). A lone surrogate of the text stays in its bytes, so that the core judges it."""
        return self._core.json_read(text.encode("utf-8", "surrogatepass"))

    def json_codec_encode(self, value: object) -> str:
        """JsonCodec.encode: rules.json_write gives the JSON text of a value of the data model, and fails with the
        kind of the data model for a value that has no JSON form (HY-54.18, HY-54.19)."""
        return self._core.json_write(value)

    def session_flash_of(self, stored: object) -> object:
        """Session.take_flash: rules.flash_of checks a stored flash and gives the map of its ``values`` and its
        ``changed`` topics, and fails with ``invalid_session_record`` for a stored flash of another form (HY-25.2,
        HY-104.23)."""
        return self._core.flash_of(stored)

    def session_kept_of(self, stored: object) -> object:
        """Session.kept and Session.keep: rules.kept_of checks stored kept values and gives the map of each region to
        the map of its values by path, and fails with ``invalid_session_record`` for kept values of another form,
        those of every region (HY-104.22, HY-104.23)."""
        return self._core.kept_of(stored)

    def page_kept_cookie(self, text: str) -> object:
        """Page._kept: rules.kept_cookie reads the cookie of the kept values to a map from each region to the map of
        its readable values by path; a cookie that is no JSON object, a region that holds no object and a value
        outside the data model give no value (HY-38.2, HY-38.11, HY-42)."""
        return self._core.kept_cookie(text)

    def accept_parse(self, value: Optional[str]) -> list[Any]:
        """Accept.parse: rules.accept_ranges gives the ranges of an `Accept` value in field order, the range `*/*` of
        the full weight for a request without `Accept`, and fails with `invalid_accept` or `invalid_weight` of
        http-negotiation (HY-116.17, HY-116.18)."""
        return self._core.accept_ranges([] if value is None else [value])

    def session_cookie_name(self, secure: bool) -> str:
        """RecordSession.cookie_name: rules.session_name (HY-45.1)."""
        return self._core.session_name(secure)

    def session_cookie_header(self, id: str, secure: bool) -> str:
        """Partial. RecordSession.cookie_header: rules.session_cookie gives the field value (HY-45.8). The server still
        decides when a response sets the cookie, only for a session that the request started (HY-45.4)."""
        return self._core.session_cookie(id, secure)

    def representation_etag(self, content_type: str, body: str) -> str:
        """RepresentationResponse.etag: rules.representation_tag (HY-122.10, HY-122.11), of the UTF-8 bytes of the
        body."""
        return self._core.representation_tag(content_type, body.encode("utf-8"))

    def request_media_type(self, content_type: str) -> str:
        """Request.media_type: rules.media_type of the value of Content-Type (HY-59.13), which raises the kind
        `malformed_content_type` (status 400) for a value that is no media type."""
        return self._core.media_type(content_type)

    def request_current_path(self, header: Optional[str]) -> Optional[str]:
        """Request.current_path: rules.current_path of the value of HX-Current-URL (HY-11.5)."""
        return self._core.current_path(header)

    def reply_cache_control(self, value: str) -> str:
        """Reply.cache_control: rules.cache_control gives the value that the reply keeps (HY-52.6)."""
        return self._core.cache_control(value)

    def reply_referrer_policy(self, value: str) -> str:
        """Reply.referrer_policy: rules.referrer_policy gives the value that the reply keeps (HY-103.2, HY-103.9)."""
        return self._core.referrer_policy(value)

    def reply_status(self, status: int) -> int:
        """Reply.status: rules.reply_status gives the page status that the reply keeps (HY-69)."""
        return self._core.reply_status(status)

    def reply_keeps_out_of_shared_caches(self, value: str) -> bool:
        """Partial. rules.keeps_out_of_shared_caches (HY-52.6), which Reply.cache_control decided inside its check; the
        server reads it for no other rule."""
        return self._core.keeps_out_of_shared_caches(value)

    def result_redirect(self, location: str) -> str:
        """Result.redirect: rules.redirect_location gives the location of the result (HY-46)."""
        return self._core.redirect_location(location)

    def result_page(self, status: int) -> int:
        """Result.page: rules.page_status gives the status of the result (HY-58)."""
        return self._core.page_status(status)

    def result_is_application_path(self, location: str) -> bool:
        """Partial. rules.is_application_path (HY-46), the test inside Result.redirect; the server has no caller of it
        besides the redirect."""
        return self._core.is_application_path(location)

    def app_vary_header(self, context: bool) -> str:
        """App._vary_header: rules.page_vary (HY-117.1)."""
        return self._core.page_vary(context)

    def app_frame_headers(self, status: int, frame_ancestors: str) -> dict[str, str]:
        """Partial. App.frame: front_functions.frame_headers gives the headers that every response carries (HY-45.5,
        HY-65.1). The server still adds them to its response, a header of the same name replaced."""
        return dict(self._core.frame_headers(status, frame_ancestors))

    def app_check_shell_path(self, path: str) -> None:
        """Partial. The static shell of App.open: rules.check_shell_path checks its path before the server reads the
        file (HY-62). The server still reads the file, and checks the data base path of the declaration against the
        routes and the meta element of the shell (HY-62.2)."""
        self._core.check_shell_path(path)

    def app_shell_text(self, path: str, data: bytes) -> str:
        """Partial. rules.shell_text gives the text of the bytes of the static shell (HY-62), which the server read."""
        return self._core.shell_text(path, data)

    def app_kept_value(self, pages: Any, region: str, path: str, text: str) -> Any:
        """Partial. The value check of the kept endpoint: front_functions.kept_value (HY-40.1). The server still
        checks the token of the form (HY-24) and stores the value in the session."""
        return self._core.kept_value(pages, region, path, text)

    def page_tag(self, body: str, masked_token: str, token: str) -> str:
        """The tag of a JSON response of Page.respond: rules.page_tag (HY-53.1)."""
        return self._core.page_tag(body, masked_token, token)

    def session_stored_token(self, stored: str) -> str:
        """Partial. Session.csrf_token: rules.stored_token checks the value that the session holds in the place of the
        token (HY-24.14). The server still reads the store and creates the token of a session that holds none
        (HY-24.1)."""
        return self._core.stored_token(stored)

    def kept_cookie_name(self, secure: bool) -> str:
        """Partial. The name of the cookie of the kept values: rules.keep_name (HYC-13.6). The server still reads the
        cookie from the request (HY-129)."""
        return self._core.keep_name(secure)

    def value_error(self, message: str, kind: str) -> ValueError:
        """The error of hyper of the category value with its kind (HY-132.2), of the class of the binding."""
        from .._binding._errors import HyperValueError

        return HyperValueError(message, kind)

    def type_error(self, message: str, kind: str) -> TypeError:
        """The error of hyper of the category type with its kind (HY-132.2), of the class of the binding."""
        from .._binding._errors import HyperTypeError

        return HyperTypeError(message, kind)

    def build_read(self, data: bytes) -> str:
        """Partial. Build.read: rules.read_build gives the build id of the bytes of a `build.json` (HY-125.18,
        HY-125.19). The server still reads the file and names the absolute path of the file in a failure
        (HY-125.18)."""
        return self._core.read_build(data)

    def build_check_id(self, text: str) -> None:
        """Partial. rules.check_build_id (HY-125.19), for a caller that holds a build id as text."""
        self._core.check_build_id(text)


class CoreBindingError(ImportError):
    """The binding of the core does not import. The server has no rule of its own in place of the core, so the first
    unit that needs a rule fails with this error, which names the module (HY-132.2)."""


_shared: Optional[CoreRules] = None


def core_rules() -> CoreRules:
    """Returns the one `CoreRules` of the process, which the first call creates from the module of the binding. A
    module that does not import fails with `CoreBindingError`, and the next call imports it again."""
    global _shared
    if _shared is None:
        try:
            from .._binding import _root as module
        except ImportError as error:
            raise CoreBindingError(
                f"hyper: the binding of the core, the module {BINDING}, does not import: {error}"
            ) from error
        _shared = CoreRules(module)
    return _shared


def open_error(message: str) -> ValueError:
    """The error with which an application fails to open: the class of the binding of the category value with the
    kind `invalid_application` (HY-106.21)."""
    return core_rules().value_error(message, "invalid_application")
