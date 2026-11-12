# Several processes that use one session of the session files at the same time (HY-104). Each process has its own
# session store, as each worker process of one server has, so only the lock of the session file holds the other
# processes back. The cases of contracts/file-sessions.json state the requests of one store.
import multiprocessing
import secrets
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions
from polyspec.php_serialize import serialize, unserialize

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
                session.close()
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
                        f"a request started the new session {session.created()}"
                    )
                session.set("count", (session.get("count") or 0) + 1)
            finally:
                session.close()
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


if __name__ == "__main__":
    unittest.main()
