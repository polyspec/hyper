"""One HTTP request with the session values that the application reads. The request target, the header values and
the raw query are text whose characters are the bytes of the request, as an HTTP server reads them; the body is
bytes."""

from __future__ import annotations

import re
from typing import Optional

from ._fields import Fields
from ._files import Files
from ._multipart import Multipart
from ._request_body import RequestBody
from ._media import JSON
from .uploaded_file import UploadedFile
from ._session import Flash

_PRINTABLE = re.compile(r"[\x21-\x7e]*\Z")
_AUTHORITY = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*:)?//[^/?#]*")
_INTEGER = re.compile(r"-?[0-9]{1,15}\Z")


class Request:
    """One HTTP request (HY-15, HY-42, HY-56, HY-57)."""

    def __init__(
        self,
        method: str,
        path: str,
        headers: Optional[dict[str, str]] = None,
        query: str = "",
        body: bytes = b"",
        flash: Optional[dict] = None,
        csrf_token: str = "",
        params: Optional[dict[str, str]] = None,
        cookies: Optional[dict[str, str]] = None,
        https: bool = False,
        selection: object = None,
        body_size: Optional[int] = None,
        media: Optional[str] = None,
        read: Optional[RequestBody] = None,
    ):
        self._method = method
        # The decoded JSON body of a representation request (HY-121), which `_as_representation` sets.
        self._json: object = None
        # The media type that the server selected for the request (HY-116); None until the server selects it.
        self._media = media
        # The size of the body that the server received, when it stopped reading a body larger than the limit
        # (HY-59); None counts the body itself.
        self._given_body_size = body_size
        self._path = path
        self._headers = {name.lower(): value for name, value in (headers or {}).items()}
        self._query = query
        self._body = body
        self._flash = flash or {}
        self._csrf_token = csrf_token
        self._params = params or {}
        self._cookies = cookies or {}
        self._https = https
        self._selection = selection
        # The query values, or None when a name or a value is not UTF-8 (HY-42, HY-56).
        self._query_fields = Fields.parse(query.encode("latin-1"))
        # The body as a host read it: a body read in chunks gives its parts (HY-131).
        self._read = read
        boundary = Multipart.boundary(self.header("Content-Type") or "")
        # The number of parts of a multipart body that is one value (HY-131.12).
        self._part_count = 0
        if read is not None and read.streamed():
            parts = read.parts()
            self._form_fields = None if parts is None else parts[0]
            self._file_parts = None if parts is None else parts[1]
        elif boundary is not None:
            # A multipart body that is one value is read once, which also gives the number of its parts.
            reader = Multipart(boundary, None, None, None, None)
            parts = reader.result() if reader.feed(body) else None
            self._form_fields = None if parts is None else parts[0]
            self._file_parts = None if parts is None else parts[1]
            self._part_count = reader.count()
        else:
            # The form values of the body, or None when a name or a value is not UTF-8 (HY-42, HY-57).
            self._form_fields = Fields.from_body(
                self.header("Content-Type") or "", body
            )
            # The file parts of the body, or None when a name, a filename or a content type is not UTF-8 (HY-113).
            self._file_parts = Files.empty()

    def _exceeded(
        self, value_limit: int, part_limit: int, file_limit: int, streams: bool
    ) -> bool:
        """Returns True when the body passed the value limit, the part limit or the file limit (HY-131.11): as its
        host read it, or for a body that is one value by its size, and by its parts and files when ``streams`` tells
        that the application reads a multipart body in chunks."""
        read = self._read
        if read is not None and (read.exceeded() or read.streamed()):
            return read.exceeded()
        largest = 0 if self._file_parts is None else self._file_parts.largest()
        return len(self._body) > value_limit or (
            streams and (self._part_count > part_limit or largest > file_limit)
        )

    def _release(self) -> None:
        """Removes the directory of the files of the body with the files that were not moved (HY-131.14)."""
        if self._read is not None:
            self._read.remove()

    @property
    def method(self) -> str:
        """The method of the request."""
        return self._method

    @property
    def https(self) -> bool:
        """Whether the request arrived over HTTPS."""
        return self._https

    def _with_session(self, flash: Flash, csrf_token: str) -> "Request":
        """Returns a copy that carries the flash values and the CSRF token of the session."""
        return self._copy(flash=flash.values, csrf_token=csrf_token)

    def _with_route(self, path: str, params: dict[str, str]) -> "Request":
        """Returns a copy with the routed path (base path removed) and the route parameters."""
        return self._copy(path=path, params=params)

    def with_header(self, name: str, value: str) -> "Request":
        """Returns a copy whose header of the name, compared without case as `header` reads it, has the value
        (HY-97)."""
        return self._copy(headers={**self._headers, name.lower(): value})

    def _with_media(self, media: str) -> "Request":
        """Returns a copy that holds the media type that the server selected for the request (HY-116)."""
        return self._copy(media=media)

    def _as_representation(self, method: str, value: object) -> "Request":
        """Returns the request that a representation handler receives: with the method, which is `GET` for a `HEAD`
        request, without the `Cookie` header and the cookies, and with the decoded JSON value of its body (HY-121)."""
        headers = {
            name: text for name, text in self._headers.items() if name != "cookie"
        }
        copy = self._copy(headers=headers)
        copy._method = method
        copy._cookies = {}
        copy._json = value
        return copy

    def json(self) -> object:
        """Returns the value of the JSON body of a representation request, or None for a request without a body
        (HY-121.9)."""
        return self._json

    def _with_selection(self, value: object) -> "Request":
        """Returns a copy that carries the value of the choice of the client rendering selection (HY-62)."""
        return self._copy(selection=value)

    def selection(self) -> object:
        """Returns the value of the choice that the client rendering selection returned for this request, or None
        for an application without client rendering (HY-62)."""
        return self._selection

    def params(self) -> dict[str, str]:
        """Returns the route parameters."""
        return dict(self._params)

    def param(self, name: str) -> Optional[str]:
        """Returns a route parameter, or None."""
        return self._params.get(name)

    def cookie(self, name: str) -> Optional[str]:
        """Returns a cookie value, or None."""
        return self._cookies.get(name)

    def valid_input(self) -> bool:
        """Returns True when the path consists of printable ASCII characters and every query and form name and value
        and HX-Current-URL are valid UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones."""
        current = self.header("HX-Current-URL")
        return (
            _PRINTABLE.fullmatch(self._path) is not None
            and (current is None or _is_utf8(current))
            and self._query_fields is not None
            and self._form_fields is not None
            and self._file_parts is not None
        )

    def body_size(self) -> int:
        """Returns the size of the body in bytes: its length, or the Content-Length header when that is larger
        (HY-59)."""
        declared = self.header("Content-Length") or ""
        try:
            length = int(declared) if declared.isdigit() else 0
        except ValueError:
            length = 0
        read = 0 if self._read is None else self._read.size()
        return max(len(self._body), length, self._given_body_size or 0, read)

    def media_type(self) -> str:
        """Returns the media type of the Content-Type header in lower case, without its parameters (HY-59)."""
        content_type = self.header("Content-Type") or ""
        return content_type.split(";", 1)[0].strip().lower()

    def header(self, name: str) -> Optional[str]:
        """Returns the value of a header, or None."""
        return self._headers.get(name.lower())

    def wants_json(self) -> bool:
        """Returns True when the selected media type of the request is application/vnd.hyper+json (HY-15, HY-116).
        The selection is read from the request and `Accept` is not read again; a request without a selection fails."""
        if self._media is None:
            raise RuntimeError("the request holds no selected media type (HY-116)")
        return self._media == JSON

    def is_region_request(self) -> bool:
        """Returns True for a region request: a JSON request that carries the HX-Request header (HY-15)."""
        return self.wants_json() and self.header("HX-Request") == "true"

    def current_path(self) -> Optional[str]:
        """Returns the path of the page that sent the request, or None (HY-11)."""
        url = self.header("HX-Current-URL")
        if url is None:
            return None
        rest = _AUTHORITY.sub("", url)
        path = re.split(r"[?#]", rest, maxsplit=1)[0]
        return path or None

    def path(self) -> str:
        """Returns the request path; after routing, the path without the base path."""
        return self._path

    def raw_query(self) -> str:
        """Returns the raw query of the request target, or the empty string (HY-56)."""
        return self._query

    def query(self) -> list[tuple[str, list[str]]]:
        """Returns every query value without nesting, as pairs of a name and its values in request order, in the
        order of the first value of each name (HY-56)."""
        return (self._query_fields or Fields.empty()).pairs()

    def query_int(self, name: str, default: int) -> int:
        """Returns the last query value of a name as an integer, or the default when it is absent or not an
        integer."""
        value = (self._query_fields or Fields.empty()).last(name)
        if value is not None and _INTEGER.fullmatch(value) is not None:
            return int(value)
        return default

    def form(self) -> list[tuple[str, list[str]]]:
        """Returns every form value of the body without nesting, as pairs of a name and its values in request order,
        in the order of the first value of each name (HY-57)."""
        return (self._form_fields or Fields.empty()).pairs()

    def form_string(self, name: str) -> str:
        """Returns the last form value of a name; an absent name gives the empty string."""
        return (self._form_fields or Fields.empty()).last(name) or ""

    def files(self) -> list[tuple[str, list[UploadedFile]]]:
        """Returns the file parts of the body as pairs of a name and its files in request order, in the order of the
        first file of each name (HY-113)."""
        return (self._file_parts or Files.empty()).pairs()

    def file(self, name: str) -> Optional[UploadedFile]:
        """Returns the last file of a name, or None (HY-113)."""
        return (self._file_parts or Files.empty()).last(name)

    def file_over(self, limit: int) -> bool:
        """Returns True when a file of the body is larger than `limit` bytes (HY-114)."""
        return (self._file_parts or Files.empty()).largest() > limit

    def flash(self, name: str) -> object:
        """Returns a flash value stored by the previous action, or None."""
        return self._flash.get(name)

    def csrf_token(self) -> str:
        """Returns the CSRF token of the session."""
        return self._csrf_token

    @staticmethod
    def target_path(target: str) -> str:
        """Returns the path of a request target: the target before `?` or `#`, after the authority of an
        absolute-form target, without decoding (HY-42)."""
        path = re.split(r"[?#]", target, maxsplit=1)[0]
        found = re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://[^/]*", path)
        if found is not None:
            path = path[len(found.group(0)) :]
        return path or "/"

    @staticmethod
    def target_query(target: str) -> str:
        """Returns the raw query of a request target: the target after its first `?` up to its first `#`
        (HY-56)."""
        before = target.split("#", 1)[0]
        question = before.find("?")
        return "" if question < 0 else before[question + 1 :]

    def _copy(self, **changes) -> "Request":
        state = {
            "path": self._path,
            "headers": self._headers,
            "flash": self._flash,
            "csrf_token": self._csrf_token,
            "params": self._params,
            "selection": self._selection,
            "body_size": self._given_body_size,
            "media": self._media,
        }
        state.update(changes)
        return Request(
            self._method,
            state["path"],
            state["headers"],
            self._query,
            self._body,
            state["flash"],
            state["csrf_token"],
            state["params"],
            self._cookies,
            self._https,
            state["selection"],
            state["body_size"],
            state["media"],
            self._read,
        )


def _is_utf8(text: str) -> bool:
    """Returns True when the bytes of a header value are valid UTF-8 (HY-42)."""
    try:
        text.encode("latin-1").decode("utf-8")
        return True
    except UnicodeDecodeError, UnicodeEncodeError:
        return False
