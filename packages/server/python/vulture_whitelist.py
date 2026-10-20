"""The code of the package that vulture reports as unused although the standard library or the test runner uses it.

A name stands bare and an attribute or method stands as an attribute of `_`, as vulture reads a whitelist.
"""

# http.server calls the do_<METHOD> method of the request handler that matches the request line, and log_message for the
# access log; close_connection and daemon_threads are attributes that http.server and socketserver read.
_.do_GET
_.do_HEAD
_.do_POST
_.do_PUT
_.do_DELETE
_.do_PATCH
_.do_OPTIONS
_.log_message
_.close_connection
_.daemon_threads

# unittest discovers the TestCase classes of tests/test_*.py by their base class.
ConcurrentSessionWrites
# FileParts of test_files.py: unittest runs its three tests, as its base FixtureTest is a TestCase (proved by python -m unittest -v).
FileParts
