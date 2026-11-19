"""The body of a request as its host reads it (HY-59, HY-131), read by the core through http-form (H35.11): the bytes
of a body that is one value, or the parts of a ``multipart/form-data`` body that is read in chunks, whose files are in a
directory of the request. The core reads the parts and checks the body, value, part and file limits in the order of the
byte that passes each; this module only keeps the answer of a host: whether the body passed a limit, and the form of a
body that failed."""

from __future__ import annotations

from typing import Any, Optional

from ..app._core_rules import NO_LIMIT, core_rules
from ._fields import Fields
from ._files import Files
from .uploaded_file import UploadedFile

__all__ = ["NO_LIMIT", "RequestBody", "body_form", "held_form"]

# The status of http-form for a body that passed one of its limits (F-25).
_PASSED = 413

# The kinds of http-form for a content type that starts no reading (HY-113.24, HY-59.12).
_NO_READING = ("no_boundary", "malformed_content_type")


def _status(error: BaseException) -> Optional[int]:
    """The status of a failure of http-form that the binding raises, or None for another error."""
    status = getattr(error, "status", None)
    return status if isinstance(status, int) else None


def body_form(form: Any) -> tuple[Fields, Files]:
    """The fields and the files of the hyper server for the form record of the core."""
    fields = Fields(
        [name for name, _ in form.fields],
        {name: list(values) for name, values in form.fields},
    )
    files = Files(
        [name for name, _ in form.files],
        {
            name: [UploadedFile._of_core(item) for item in items]
            for name, items in form.files
        },
    )
    return fields, files


class RequestBody:
    """Reads the chunks of a request body through the core."""

    def __init__(
        self,
        content_type: str,
        limit: int,
        stream: bool,
        value_limit: int,
        part_limit: int,
        file_limit: int,
        content_length: Optional[str] = None,
    ):
        """Starts the body of the content type with its four limits; ``stream`` tells whether a multipart body is read
        in chunks, which it is when ``multipart/form-data`` is a form type of the application (HY-131.1). The core
        starts the reader in chunks only for a ``multipart/form-data`` type with a boundary (HY-113.24)."""
        rules = core_rules()
        limits = rules.body_limits(limit, value_limit, part_limit, file_limit)
        self.__over = False
        self.__failed = False
        self.__finished = False
        self.__failure: Optional[BaseException] = None
        # HY-131.29: the core fails a Content-Length that is no number with invalid_content_length and a number above
        # the body limit with body_limit before any byte is read; that failure is the failure of the body.
        try:
            self.__body = rules.request_body_start(
                content_type or None, content_length, stream, limits
            )
        except Exception as error:
            if _status(error) is None:
                raise
            self.__failure = error
            if _status(error) == _PASSED:
                self.__over = True
            else:
                self.__failed = True
            self.__body = rules.request_body_start(
                content_type or None, None, stream, limits
            )

    def feed(self, chunk: bytes) -> bool:
        """Reads the next chunk, and returns False when the body passed a limit, after which it holds no bytes
        (HY-59.15, HY-131.32). A body that fails with ``invalid`` or ``header_limit`` keeps being read and gives no
        form (HY-113.25)."""
        if self.__over:
            return False
        if self.__failed:
            return True
        try:
            self.__body.feed(chunk)
        except Exception as error:
            if _status(error) is None:
                raise
            self.__failure = error
            if _status(error) == _PASSED:
                self.__over = True
                return False
            self.__failed = True
        return True

    def exceeded(self) -> bool:
        """Returns True when the body passed the body limit, the value limit, the part limit or the file limit
        (HY-131.32)."""
        return self.__over

    def size(self) -> int:
        """Returns the number of bytes that were read."""
        return self.__body.size()

    def held(self) -> bytes:
        """Returns the body as one value: no bytes for a body read in chunks and for a body that passed the limit."""
        return bytes(self.__body.held())

    def streamed(self) -> bool:
        """Returns True when the body is read in chunks."""
        return self.__body.streamed()

    def parts(self) -> Optional[tuple[Fields, Files]]:
        """Returns the text fields and the files of a body read in chunks, or None when it failed or passed a limit
        (HY-131.5, HY-113.25). The first call ends the body."""
        if not self.__body.streamed() or self.__over or self.__failed:
            return None
        try:
            if not self.__finished:
                self.__finished = True
                self.__body.finish()
            return body_form(self.__body.parts())
        except Exception as error:
            if _status(error) is None:
                raise
            self.__failure = error
            if _status(error) == _PASSED:
                self.__over = True
            self.__failed = True
            return None

    def failure(self) -> Optional[BaseException]:
        """Returns the first failure of the body as http-form gives it, or None (HY-113.25, HY-131.32)."""
        return self.__failure

    def directory(self) -> Optional[str]:
        """Returns the directory of the files of the body, or None for a body that is one value."""
        directory = self.__body.directory()
        return None if directory is None else str(directory)

    def remove(self) -> None:
        """Removes the directory of the files with the files that were not moved (HY-131.14)."""
        self.__body.remove()


def held_form(
    content_type: str, body: bytes, value_limit: int, part_limit: int, file_limit: int
) -> tuple[Optional[tuple[Fields, Files]], bool, bool]:
    """Reads a body held as one value through the core: its form, or None when it fails with ``invalid`` or
    ``header_limit`` (HY-42, HY-113.25), whether it passed a limit (HY-131.32), and whether its type is a
    ``multipart/form-data`` type without a boundary, or with an empty one (HY-113.24)."""
    rules = core_rules()
    limits = rules.body_limits(NO_LIMIT, value_limit, part_limit, file_limit)
    try:
        return (
            body_form(rules.read_held_body(content_type or None, body, limits)),
            False,
            False,
        )
    except Exception as error:
        status = _status(error)
        if status is None:
            raise
        # HY-113.24, HY-59.12: a type without a boundary or that is no media type fails no reading and gives no form
        # value; its Content-Type is judged after the route.
        kind = getattr(error, "kind", None)
        if kind in _NO_READING:
            return (Fields.empty(), Files.empty()), False, kind == "no_boundary"
        return None, status == _PASSED, False
