# The static shell of a client rendering that the server may not read (HY-62): the cases of contracts/client.json state
# every other declaration that the open refuses, and the mode of a file is not a value of a case.
import os
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.choice import Choice
from polyspec.hyper.client_rendering import ClientRendering

from .fixture_handlers import Counter, fixture_app


class ShellTest(unittest.TestCase):
    def test_a_static_shell_without_read_permission_fails_with_the_open_error(
        self,
    ) -> None:
        # HY-62, HY-106.6: the open fails with exactly ValueError when the shell is a file that cannot be read.
        with tempfile.TemporaryDirectory() as directory:
            shell = Path(directory) / "unreadable.html"
            shell.write_bytes(b'<meta name="hyper-api" content="/_props">')
            shell.chmod(0)
            # The user root reads a file of every mode, so the mode states nothing for it.
            if os.access(shell, os.R_OK):
                self.skipTest("the user of the run reads a file of every mode")
            client = ClientRendering(
                str(shell), "/_props", lambda request: Choice(True, None)
            )
            with self.assertRaises(ValueError) as raised:
                fixture_app(Counter(), client_rendering=client)
            self.assertIs(ValueError, type(raised.exception))
            self.assertIn("is not a readable file", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
