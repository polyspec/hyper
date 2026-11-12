# The steps of contracts/response.json (HY-106.1): a response that the constructor or Response.text makes, and the
# copies that with_header returns.
from polyspec.hyper.server.response import Response


def values(case) -> None:
    """Makes the response, applies each header of `with` to the last copy, and compares the last copy and the headers
    of the first response."""
    make = case.input("make")
    status = case.input("status")
    body = case.input("body")
    if make == "constructor":
        pairs = case.input("headers") if case.has("headers") else []
        first = Response(status, {name: value for name, value in pairs}, body)
    elif make == "text":
        first = Response.text(status, body)
    else:
        raise LookupError(f"the word {make} of make is unknown")
    response = first
    for name, value in case.input("with") if case.has("with") else []:
        response = response.with_header(name, value)
    case.compare(
        "response",
        {"status": response.status, "headers": response.headers, "body": response.body},
    )
    case.compare("original", first.headers)
