"""The code of the package that vulture reports as unused although the standard library or the test runner uses it.

A name stands bare and an attribute or method stands as an attribute of `_`, as vulture reads a whitelist.
"""

# http.server calls log_message for the access log; close_connection and daemon_threads are attributes that http.server
# and socketserver read.
_.log_message
_.close_connection
_.daemon_threads

# inspect.signature and typing.get_type_hints read the parameters that tests/steps/app_handlers.py sets on a handler
# of a case, by which the container gives the handler its services.
_.__signature__
_.__annotations__

# unittest discovers the TestCase classes of tests/test_*.py by their base class.
CaseRunner
# FileParts of test_files.py: unittest runs its three tests, as its base FixtureTest is a TestCase (proved by python -m unittest -v).
FileParts
