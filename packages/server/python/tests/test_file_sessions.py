# The session files (HY-45, HY-72) and several processes that use one session at the same time (HY-104). Each process has its own session store, as each
# worker process of one server has, so only the lock of the session file holds the other processes back.
import multiprocessing
import os
import secrets
import tempfile
import time
import unittest
from pathlib import Path

from polyspec.hyper._session import Session
from polyspec.hyper.file_sessions import FileSessions, _cookie_header, _cookie_name
from polyspec.hyper.session import ArraySession
from polyspec.php_serialize import UnserializeError, serialize, unserialize

ROUNDS = 400
PROCESSES = 4
REQUESTS = 200


def write_rounds(directory: str, identifier: str, queue) -> None:
    """Opens the session of `identifier` and writes it ROUNDS times; reports each failed write to `queue`."""
    errors: list[str] = []
    try:
        sessions = FileSessions(directory)
        for number in range(ROUNDS):
            session = sessions._open(identifier)
            session.set("number", number)
            try:
                session._close()
            except OSError as error:
                errors.append(f"{type(error).__name__}: {error}")
    finally:
        queue.put(errors)


def count_requests(directory: str, identifier: str, queue) -> None:
    """Runs REQUESTS requests of the session of `identifier`; each reads the token and adds one to the count, as a form
    post reads the CSRF token and writes a flash value. Reports the requests that found no session; an error ends the
    process with a nonzero exit code."""
    failures: list[str] = []
    try:
        sessions = FileSessions(directory)
        for _ in range(REQUESTS):
            session = sessions._open(identifier)
            try:
                if session.get("token") is None:
                    failures.append(
                        f"a request started the new session {session._created}"
                    )
                session.set("count", (session.get("count") or 0) + 1)
            finally:
                session._close()
    finally:
        queue.put(failures)


class ConcurrentSessionRequests(unittest.TestCase):
    def test_runs_the_requests_of_one_session_in_several_processes_one_after_another(
        self,
    ) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        identifier = secrets.token_bytes(32).hex()
        (Path(directory.name) / f"sess_{identifier}").write_bytes(
            serialize({"token": "t", "count": 0})
        )
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        processes = [
            context.Process(
                target=count_requests, args=(directory.name, identifier, queue)
            )
            for _ in range(PROCESSES)
        ]
        for process in processes:
            process.start()
        failures = [queue.get() for _ in processes]
        for process in processes:
            process.join()
        self.assertEqual([0] * PROCESSES, [process.exitcode for process in processes])
        self.assertEqual([[]] * PROCESSES, failures)
        stored = unserialize((Path(directory.name) / f"sess_{identifier}").read_bytes())
        self.assertEqual(
            PROCESSES * REQUESTS,
            stored["count"],
            "expected every request to add one to the count, actual a count that lost the writes of some requests",
        )


class ConcurrentSessionWrites(unittest.TestCase):
    def test_two_processes_writing_one_session_do_not_fail(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        identifier = secrets.token_bytes(32).hex()
        (Path(directory.name) / f"sess_{identifier}").write_bytes(b"a:0:{}")
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        processes = [
            context.Process(
                target=write_rounds, args=(directory.name, identifier, queue)
            )
            for _ in range(2)
        ]
        for process in processes:
            process.start()
        errors = [queue.get() for _ in processes]
        for process in processes:
            process.join()
        self.assertEqual(
            [[], []],
            errors,
            "expected no failed write, actual the failed writes of each process above",
        )


class StoredMapsTest(unittest.TestCase):
    def test_reads_a_stored_list_as_the_map_that_a_php_array_keeps_as_a_list(
        self,
    ) -> None:
        store = ArraySession()
        session = Session(store)
        store.set("_hyper_flash", {"values": [], "changed": []})
        flash = session.take_flash()
        self.assertEqual(({}, []), (flash.values, flash.changed))
        store.set("_hyper_flash", {"values": ["a"], "changed": ["t"]})
        flash = session.take_flash()
        self.assertEqual(({"0": "a"}, ["t"]), (flash.values, flash.changed))
        store.set("_hyper_keep", {"rows": ["a", "b"]})
        self.assertEqual({"0": "a", "1": "b"}, session.kept("rows"))
        session.keep("rows", "sort", "title")
        self.assertEqual({"0": "a", "1": "b", "sort": "title"}, session.kept("rows"))


class FileSessionsTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.sessions = FileSessions(directory.name)

    def test_ends_a_session_after_its_lifetime_and_removes_expired_files(self) -> None:
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        identifier = first._created
        old = time.time() - 1441
        os.utime(self.directory / f"sess_{identifier}", (old, old))
        later = self.sessions._open(identifier)
        self.assertIsNone(later.get("a"))
        self.assertNotEqual(identifier, later._created)
        later._close()
        self.assertEqual(1, self.sessions._collect())
        self.assertEqual(
            [f"sess_{later._created}"], [file.name for file in self.directory.iterdir()]
        )

    def test_raises_when_a_session_file_cannot_be_read_and_starts_no_new_session(
        self,
    ) -> None:
        identifier = secrets.token_bytes(32).hex()
        (self.directory / f"sess_{identifier}").write_bytes(b's:5:"token')
        session = self.sessions._open(identifier)
        with self.assertRaises(UnserializeError):
            session.get("token")
        session._close()
        self.assertIsNone(session._created)

    def test_creates_no_file_for_an_identifier_without_a_session(self) -> None:
        unknown = self.sessions._open("e" * 64)
        self.assertEqual([], list(self.directory.iterdir()))
        unknown._close()
        self.assertEqual([], list(self.directory.iterdir()))

    def test_reads_a_session_file_without_bytes_as_an_empty_session(self) -> None:
        identifier = "a" * 32
        (self.directory / f"sess_{identifier}").write_bytes(b"")
        session = self.sessions._open(identifier)
        self.assertIsNone(session.get("a"))
        session._close()
        self.assertIsNone(session._created)
        self.assertEqual(
            b"a:0:{}", (self.directory / f"sess_{identifier}").read_bytes()
        )

    def test_a_request_that_changes_nothing_keeps_the_bytes_of_the_record(self) -> None:
        identifier = "a" * 32
        file = self.directory / f"sess_{identifier}"
        record = (
            b'a:3:{s:1:"f";d:1;s:1:"o";O:8:"stdClass":1:{s:1:"0";i:1;}'
            b's:1:"r";a:2:{i:0;a:0:{}i:1;R:5;}}'
        )
        file.write_bytes(record)
        old = time.time() - 100
        os.utime(file, (old, old))
        session = self.sessions._open(identifier)
        self.assertEqual({"0": 1}, session.get("o"))
        session._close()
        self.assertEqual(record, file.read_bytes())
        self.assertGreater(file.stat().st_mtime, old + 50)
        changed = self.sessions._open(identifier)
        changed.set("n", 1)
        changed._close()
        self.assertEqual(
            record[:-1].replace(b"a:3:", b"a:4:", 1) + b's:1:"n";i:1;}',
            file.read_bytes(),
        )

    def test_a_shorter_record_leaves_no_bytes_of_the_longer_one(self) -> None:
        identifier = "a" * 32
        file = self.directory / f"sess_{identifier}"
        file.write_bytes(serialize({"a": "x" * 100}))
        session = self.sessions._open(identifier)
        session.remove("a")
        session._close()
        self.assertEqual(b"a:0:{}", file.read_bytes())

    def test_reads_the_values_of_php_arrays_as_the_data_model(self) -> None:
        identifier = "a" * 32
        (self.directory / f"sess_{identifier}").write_bytes(
            b'a:3:{i:0;s:1:"z";s:1:"m";a:2:{i:7;s:1:"x";s:1:"y";i:1;}'
            b's:1:"o";O:8:"stdClass":0:{}}'
        )
        session = self.sessions._open(identifier)
        self.assertEqual("z", session.get("0"))
        self.assertEqual({"7": "x", "y": 1}, session.get("m"))
        self.assertEqual({}, session.get("o"))
        session._close()

    def test_keeps_a_map_that_a_php_array_would_read_as_a_list(self) -> None:
        first = self.sessions._open(None)
        first.set("empty", {})
        first.set("numbered", {"0": "a", "1": "b"})
        first.set("list", ["a"])
        first._close()
        record = (self.directory / f"sess_{first._created}").read_bytes()
        self.assertEqual(
            b'a:3:{s:5:"empty";O:8:"stdClass":0:{}'
            b's:8:"numbered";O:8:"stdClass":2:{s:1:"0";s:1:"a";s:1:"1";s:1:"b";}'
            b's:4:"list";a:1:{i:0;s:1:"a";}}',
            record,
        )
        later = self.sessions._open(first._created)
        self.assertEqual({}, later.get("empty"))
        self.assertEqual({"0": "a", "1": "b"}, later.get("numbered"))
        self.assertEqual(["a"], later.get("list"))
        later._close()

    def test_an_identifier_that_a_renewal_removed_names_no_session(
        self,
    ) -> None:
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        holder = self.sessions._open(first._created)
        holder.renew()
        holder._close()
        self.assertIsNone(self.sessions._hold(first._created, blocking=True))

    def test_names_the_session_cookie_hy_session_over_http_and_host_prefixed_over_https(
        self,
    ) -> None:
        identifier = "a" * 64
        self.assertEqual("hy-session", _cookie_name(False))
        self.assertEqual("__Host-hy-session", _cookie_name(True))
        self.assertEqual(
            f"hy-session={identifier}; path=/; HttpOnly; SameSite=Lax",
            _cookie_header(identifier, False),
        )
        self.assertEqual(
            f"__Host-hy-session={identifier}; path=/; secure; HttpOnly; SameSite=Lax",
            _cookie_header(identifier, True),
        )

    def test_accepts_only_identifiers_that_it_created(self) -> None:
        for cookie in ["abc", "../../etc/passwd", "f" * 64, "F" * 64, "a" * 129]:
            session = self.sessions._open(cookie)
            self.assertIsNone(session.get("a"), cookie)
            self.assertNotEqual(cookie, session._created, cookie)
            session._close()

    def test_renews_a_session_with_the_same_values_and_no_file_of_the_old_one(
        self,
    ) -> None:
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        old = first._created
        session = self.sessions._open(old)
        session.renew()
        session._close()
        self.assertNotEqual(old, session._created)
        self.assertEqual(
            [f"sess_{session._created}"],
            [file.name for file in self.directory.iterdir()],
        )
        self.assertEqual(1, self.sessions._open(session._created).get("a"))

    def test_requires_an_existing_absolute_directory_and_a_positive_lifetime(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "absolute"):
            FileSessions("var/sessions")
        with self.assertRaisesRegex(ValueError, "lifetime"):
            FileSessions(str(self.directory), lifetime=0)


if __name__ == "__main__":
    unittest.main()
