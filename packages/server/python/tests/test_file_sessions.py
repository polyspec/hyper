# Two processes that write one session file at the same time (HY-104). Each process has its own session store, so the
# lock of a store does not hold the other process back, as two worker processes of one server do not.
import multiprocessing
import secrets
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions

ROUNDS = 400


def write_rounds(directory: str, identifier: str, queue) -> None:
    """Opens the session of `identifier` and writes it ROUNDS times; reports each failed write to `queue`."""
    errors: list[str] = []
    try:
        sessions = FileSessions(directory)
        for number in range(ROUNDS):
            session = sessions.open(identifier)
            session.set('number', number)
            try:
                session.close()
            except OSError as error:
                errors.append(f'{type(error).__name__}: {error}')
    finally:
        queue.put(errors)


class ConcurrentSessionWrites(unittest.TestCase):
    def test_two_processes_writing_one_session_do_not_fail(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        identifier = secrets.token_bytes(32).hex()
        (Path(directory.name) / identifier).write_text('{}', encoding='utf-8')
        context = multiprocessing.get_context('spawn')
        queue = context.Queue()
        processes = [context.Process(target=write_rounds, args=(directory.name, identifier, queue)) for _ in range(2)]
        for process in processes:
            process.start()
        errors = [queue.get() for _ in processes]
        for process in processes:
            process.join()
        self.assertEqual([[], []], errors, 'expected no failed write, actual the failed writes of each process above')


if __name__ == '__main__':
    unittest.main()
