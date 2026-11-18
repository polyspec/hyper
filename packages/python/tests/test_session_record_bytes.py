"""The session record in the form php_serialize of PHP (HY-104.13, HY-104.14): the record codec is
polyspec.php_serialization, so a record with a key of bytes that are not UTF-8, the floats 1.5 and 1.0 and a nested
stdClass reads to the values of the data model and writes back the same bytes, and a stdClass that the application makes
with that package is stored as it is (H35.77)."""

from __future__ import annotations

import unittest
from typing import Optional

from polyspec.php_serialization import StdClass, unserialize
from polyspec.hyper.session._record_session import RecordSession

# The bytes of PHP serialize(["\xff\xfe" => 1, "a" => 1.5, "b" => 1.0, "o" => (object) ["x" => 1]]).
RECORD = b'a:4:{s:2:"\xff\xfe";i:1;s:1:"a";d:1.5;s:1:"b";d:1;s:1:"o";O:8:"stdClass":1:{s:1:"x";i:1;}}'


class FixedSession(RecordSession):
    """A session whose record is the given bytes, as a store of a request gives it."""

    def __init__(self, record: bytes) -> None:
        super().__init__("a" * 32)
        self._record = record

    def stored(self) -> Optional[bytes]:
        return self._record

    def close(self) -> None:
        pass


class SessionRecordBytesTest(unittest.TestCase):
    def test_reads_a_byte_key_and_floats_and_writes_the_same_bytes_back(self) -> None:
        session = FixedSession(RECORD)
        self.assertEqual(session.get("a"), 1.5)
        self.assertEqual(session.get("o"), {"x": 1})
        self.assertEqual(session.serialized(), RECORD)
        stored = unserialize(session.serialized() or b"")
        assert isinstance(stored, dict)
        self.assertEqual(list(stored)[0], b"\xff\xfe")
        self.assertIsInstance(stored["b"], float)

    def test_stores_a_stdclass_of_php_serialization_as_php_writes_it(self) -> None:
        session = FixedSession(b"")
        session.set("f", 1.5)
        session.set("o", StdClass({"x": 1}))
        self.assertEqual(
            session.serialized(),
            b'a:2:{s:1:"f";d:1.5;s:1:"o";O:8:"stdClass":1:{s:1:"x";i:1;}}',
        )


if __name__ == "__main__":
    unittest.main()
