"""The response of a representation request (HY-122): the checks of what a handler returned, its headers, its body as
the JSON text of HY-54 and its strong tag."""

from __future__ import annotations

import hashlib
import re

from ._json_codec import JsonCodec
from .representation import Representation
from .response import Response
from .result import Result

_STATUSES = (200, 201, 204, 400, 401, 403, 404, 406, 409, 412, 415, 422, 428)
_ALLOWED = ("location", "www-authenticate", "cache-control")
# An absolute URI starts with a scheme and a colon (RFC 3986, section 4.3).
_ABSOLUTE = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:")


class RepresentationResponse:
    """Builds the response of a representation from what its handler returned."""

    @staticmethod
    def of(
        returned: object, content_type: str, vary: str, authorized: bool, base_path: str
    ) -> Response:
        """Returns the response of what a handler returned, with the `Content-Type` of its type, `Vary` and its
        `Cache-Control`; raises ValueError for a value, a status, a header or a body that HY-122 does not allow, which
        answers the 500 of HY-43."""
        if not isinstance(returned, Representation):
            raise ValueError(
                "hyper: a representation handler returned no Representation (HY-122)"
            )
        status = returned.status
        if isinstance(status, bool) or status not in _STATUSES:
            raise ValueError(
                f"hyper: a representation handler returned the status {status} (HY-122)"
            )
        given = {name.lower(): value for name, value in returned.headers.items()}
        for name in given:
            if name not in _ALLOWED:
                raise ValueError(
                    f"hyper: a representation handler set the header {name} (HY-122)"
                )
        if status == 401 and "www-authenticate" not in given:
            raise ValueError(
                "hyper: a 401 of a representation has no WWW-Authenticate (HY-122)"
            )
        if status == 201 and "location" not in given:
            raise ValueError(
                "hyper: a 201 of a representation has no Location (HY-122)"
            )
        if status == 204 and returned.body is not None:
            raise ValueError("hyper: a 204 of a representation has a body (HY-122)")
        if status == 200 and returned.body is None:
            raise ValueError("hyper: a 200 of a representation has no body (HY-122)")
        headers: dict = {}
        body = ""
        if returned.body is not None:
            body = JsonCodec.encode(returned.body)
            headers["Content-Type"] = content_type
        headers["Cache-Control"] = RepresentationResponse._cache_policy(
            status, given.get("cache-control"), authorized
        )
        headers["Vary"] = vary
        if "location" in given:
            headers["Location"] = RepresentationResponse._sent_location(
                given["location"], base_path
            )
        if "www-authenticate" in given:
            if not isinstance(given["www-authenticate"], str):
                raise ValueError(
                    "hyper: a WWW-Authenticate of a representation is not a string (HY-122)"
                )
            headers["WWW-Authenticate"] = given["www-authenticate"]
        return Response(status, headers, body)

    @staticmethod
    def etag(content_type: str, body: str) -> str:
        """Returns the strong tag of a body of a type: the first 32 hexadecimal digits of the SHA-256 digest of the
        `Content-Type`, a line feed and the body, in quotes (HY-122.10)."""
        digest = hashlib.sha256(f"{content_type}\n{body}".encode("utf-8")).hexdigest()
        return f'"{digest[:32]}"'

    @staticmethod
    def _cache_policy(status: int, given: object, authorized: bool) -> str:
        """Returns the `Cache-Control` of a response: `no-store` for a status of 400 or more, which a handler must
        not set, the value of the handler, which a request with `Authorization` keeps out of shared caches, or the
        default (HY-122.6, HY-122.7)."""
        if status >= 400:
            if given is not None:
                raise ValueError(
                    f"hyper: a representation handler set Cache-Control on a {status} (HY-122)"
                )
            return "no-store"
        if given is None:
            return "private, no-cache" if authorized else "no-cache"
        if not isinstance(given, str):
            raise ValueError(
                "hyper: a Cache-Control of a representation is not a string (HY-122)"
            )
        directives = [
            item.split("=", 1)[0].strip(" \t").lower() for item in given.split(",")
        ]
        shared = "public" in directives or "s-maxage" in directives
        if authorized and (
            shared or not ("private" in directives or "no-store" in directives)
        ):
            raise ValueError(
                "hyper: a Cache-Control of a representation lets a shared cache store the response of a request "
                "with Authorization (HY-122)"
            )
        return given

    @staticmethod
    def _sent_location(location: object, base_path: str) -> str:
        """Returns the `Location` of a response: an absolute URI as it is, and an application path with the base path
        of the request; another value fails (HY-122.5)."""
        if not isinstance(location, str):
            raise ValueError(
                "hyper: a Location of a representation is not a string (HY-122)"
            )
        if _ABSOLUTE.match(location) is not None:
            return location
        # Result.redirect checks that the location is an application path (HY-46).
        Result.redirect(location)
        return base_path + location
