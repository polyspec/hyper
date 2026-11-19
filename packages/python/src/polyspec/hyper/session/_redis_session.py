"""The session store of one request of the Redis sessions (HY-24, HY-45, HY-72, HY-115): the record session of the
Redis store of the session-store library, with the values of the data model as `FileSession` gives them."""

from __future__ import annotations

from ._file_session import FileSession


class RedisSession(FileSession):
    """The session store of one request of the Redis sessions."""
