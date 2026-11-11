"""The state machine that reads a ``multipart/form-data`` body in chunks (HY-131): it finds the delimiters, gives the
header lines and the content of each part to the reader that extends it, and holds besides one chunk at most the
delimiter or the header lines of one part."""

from __future__ import annotations


class MultipartReader:
    """Reads the delimiters, the header lines and the content of the parts of a body."""

    # The largest header of a part in bytes (HY-113.16).
    _HEADER_LIMIT = 8192

    def __init__(self, boundary: str):
        # ``--`` and the boundary, and the same after the CRLF that ends the content of a part (HY-131.2, HY-131.3).
        self.__delimiter = b"--" + boundary.encode("latin-1")
        self.__separator = b"\r\n" + self.__delimiter
        self.__buffer = b""
        # One of preamble, delimiter, headers, content, done and failed.
        self.__state = "preamble"
        # True until the body is known not to start with the delimiter.
        self.__first = True

    def feed(self, chunk: bytes) -> bool:
        """Reads the next chunk of the body, and returns False when the body failed (HY-131.5)."""
        if self.__state == "failed":
            return False
        if self.__state == "done":
            return True
        self.__buffer += chunk
        while self._advance():
            pass
        return self.__state != "failed"

    def closed(self) -> bool:
        """Returns True when the body ended with the ``--`` after a delimiter (HY-131.4)."""
        return self.__state == "done"

    def buffered(self) -> int:
        """Returns the number of bytes that the reader holds between two chunks."""
        return len(self.__buffer)

    def part_started(self, lines: list[str]) -> bool:
        """Receives the header lines of a part, and returns False to fail the body."""
        raise NotImplementedError

    def part_data(self, data: bytes) -> bool:
        """Receives the next bytes of the content of the part, and returns False to fail the body."""
        raise NotImplementedError

    def part_ended(self) -> bool:
        """Receives the end of the part, and returns False to fail the body."""
        raise NotImplementedError

    def _advance(self) -> bool:
        """Takes one step of the state machine, and returns False when it needs another chunk or has ended."""
        buffer = self.__buffer
        length = len(buffer)
        if self.__state == "preamble":
            if self.__first:
                if length < len(self.__delimiter):
                    if self.__delimiter.startswith(buffer):
                        return False
                elif buffer.startswith(self.__delimiter):
                    self.__first = False
                    return self._next("delimiter", len(self.__delimiter))
                self.__first = False
            index = buffer.find(self.__separator)
            if index >= 0:
                return self._next("delimiter", index + len(self.__separator))
            self.__buffer = buffer[length - min(length, len(self.__separator) - 1) :]
            return False
        if self.__state == "delimiter":
            if length < 2:
                return False
            after = buffer[:2]
            if after == b"--":
                self.__buffer = b""
                self.__state = "done"
                return False
            return self._next("headers", 2) if after == b"\r\n" else self._fail()
        if self.__state == "headers":
            if length < 2:
                return False
            empty = buffer.startswith(b"\r\n")
            end = 0 if empty else buffer.find(b"\r\n\r\n")
            if end < 0:
                return self._fail() if length >= self._HEADER_LIMIT + 4 else False
            if end > self._HEADER_LIMIT:
                return self._fail()
            lines = [] if empty else buffer[:end].decode("latin-1").split("\r\n")
            delimiter = self.__delimiter.decode("latin-1")
            if any(line.startswith(delimiter) for line in lines):
                return self._fail()
            self._next("content", 2 if empty else end + 4)
            return self.part_started(lines) or self._fail()
        if self.__state == "content":
            index = buffer.find(self.__separator)
            if index >= 0:
                if index > 0 and not self.part_data(buffer[:index]):
                    return self._fail()
                if not self.part_ended():
                    return self._fail()
                return self._next("delimiter", index + len(self.__separator))
            keep = min(length, len(self.__separator) - 1)
            if length > keep and not self.part_data(buffer[: length - keep]):
                return self._fail()
            self.__buffer = buffer[length - keep :]
            return False
        return False

    def _next(self, state: str, read: int) -> bool:
        """Drops the bytes that were read and enters the state."""
        self.__buffer = self.__buffer[read:]
        self.__state = state
        return True

    def _fail(self) -> bool:
        self.__buffer = b""
        self.__state = "failed"
        return False
