"""The session record of a key that is no array key (HY-104.13): a Python server reads a record as the data model, and
a record whose key is no array key fails the request with the message of the record codec."""

from __future__ import annotations

import unittest
from typing import Optional

from polyspec.hyper.session._record_session import RecordSession


class FixedSession(RecordSession):
    """A session whose record is the given bytes, as a store of a request gives it."""

    def __init__(self, record: bytes) -> None:
        super().__init__("a" * 32)
        self._record = record

    def stored(self) -> Optional[bytes]:
        return self._record

    def close(self) -> None:
        pass


class RecordSessionKeysTest(unittest.TestCase):
    def test_refuses_a_record_whose_key_is_a_float_with_the_message_of_the_codec(self) -> None:
        # Serialize-form bytes of a map with the float key 1.5: a PHP array key is an integer or a text, so the codec
        # of the record refuses the key when the session reads the record.
        session = FixedSession(b"a:1:{d:1.5;i:1;}")
        with self.assertRaisesRegex(Exception, "expects an integer or a string key"):
            session.get("a")


if __name__ == "__main__":
    unittest.main()
