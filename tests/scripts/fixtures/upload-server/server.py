"""The Python server of tests/scripts/upload-servers.test.mts: the `http.server` server of `create_server`, with the
application that the test built in UPLOAD_APP. The request hook answers every request with what the request gave of its
body as JSON: whether its input is valid, its form values, and the name, the filename, the content type, the size and
the SHA-256 digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of
requests in the temporary directory while the request runs. It prints the address that it listens on.

The variables of a start (the hooks are installed only when UPLOAD_LOG is set, so a start without it runs no hook):
  UPLOAD_ANSWER  the request hook: unset (the JSON above), app, none (no request hook), mark, accept, alone,
                 alone-gate, throws, not-a-response, cookies
  UPLOAD_LOG     the file that receives one line for each call of the request hook, of the shared handler, of a
                 loader, of the response hook, of the write hook and of the disconnect hook; with it the server
                 prints `ended <client port>` when the thread of a connection returned
  UPLOAD_ERRORS  the file that receives the log of the application (the standard error)
  UPLOAD_HOOK    throws: the response hook throws after its line
  UPLOAD_HTTPS   1: the application declares https
  UPLOAD_FILES   the directory of public files
  UPLOAD_GATE    the port of the gate of the test; UPLOAD_GATE_AT=shared stops the shared handler at it"""

import hashlib
import json
import math
import os
import resource
import socket
import sys
import tempfile

from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.media_type import MediaType
from polyspec.hyper.reply import Reply
from polyspec.hyper.representation import Representation
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper.result import Result
from polyspec.hyper.server import create_server

application = os.environ["UPLOAD_APP"]
moved = os.environ["UPLOAD_MOVED"]
limit = int(os.environ["UPLOAD_LIMIT"])
log = os.environ.get("UPLOAD_LOG")
mode = os.environ.get("UPLOAD_ANSWER", "")
FILLER = "x" * (6 * 1024 * 1024)
if "UPLOAD_ERRORS" in os.environ:
    sys.stderr = open(os.environ["UPLOAD_ERRORS"], "a", buffering=1, encoding="utf-8")


def line(text: str) -> None:
    """Appends one line to the hook log; without UPLOAD_LOG nothing is written."""
    if log is not None:
        with open(log, "a", encoding="utf-8") as target:
            target.write(f"{text}\n")


def dash(value) -> str:
    return "-" if value is None else value


def elapsed_of(value: float) -> str:
    return "ok" if math.isfinite(value) and value >= 0 else "bad"


def notes_of(reply: Reply) -> str:
    return json.dumps(dict(reply.notes()), separators=(",", ":"))


def mark(request: Request) -> str:
    return f"{request.method} {request.path()} mark={dash(request.header('X-Mark'))}"


def loaded(name: str, request: Request) -> None:
    """The line of a handler, which reads the header by its name in lower case (HY-97.4)."""
    line(f"load {name} mark={dash(request.header('x-mark'))}")


def gate(point: str) -> None:
    """Stops at the gate of the test until the test opens it or closes the connection of the gate."""
    with socket.create_connection(
        ("127.0.0.1", int(os.environ["UPLOAD_GATE"]))
    ) as connection:
        connection.sendall(f"gate {point}\n".encode())
        received = b""
        while b"open\n" not in received:
            block = connection.recv(64)
            if not block:
                break
            received += block


def item(request: Request, media: MediaType) -> Representation:
    """The representation of an item: a PUT answers the JSON value that it read, and a GET the item of the path."""
    if request.method == "PUT":
        return Representation(200, request.json())
    return Representation(200, {"id": request.param("id"), "title": "é"})


def around(request, answer):
    """The request hook of UPLOAD_ANSWER."""
    line(
        f"around {request.method} {request.path()} mark={dash(request.header('X-Mark'))}"
    )
    if mode == "app":
        return answer(request)
    if mode == "mark":
        return answer(request.with_header("X-Mark", "changed")).with_header(
            "X-Around", "yes"
        )
    if mode == "accept":
        return answer(request.with_header("Accept", "application/vnd.hyper+json"))
    if mode == "alone":
        return Response.text(418, "alone")
    if mode == "alone-gate":
        gate("around")
        return Response.text(200, FILLER)
    if mode == "throws":
        raise RuntimeError("around boom")
    if mode == "not-a-response":
        return "not a response"
    if mode == "cookies":
        return Response.text(
            200,
            json.dumps(
                {"a": request.cookie("a"), "b": request.cookie("b")},
                separators=(",", ":"),
                ensure_ascii=False,
            ),
        )
    return upload(request)


def upload(request):
    """The answer of the first form of this file: what the request gave of its body."""
    # UPLOAD_USAGE=1 is the form of benchmarks/uploads.mts: the sizes of the files without a move, and the processor
    # time and the largest memory of the process.
    usage = os.environ.get("UPLOAD_USAGE") == "1"
    files = []
    for name, items in request.files():
        for uploaded in items:
            if usage:
                files.append([name, uploaded.size()])
                continue
            target = os.path.join(moved, f"python-{len(files)}")
            uploaded.move_to(target)
            digest = hashlib.sha256()
            with open(target, "rb") as source:
                while block := source.read(1 << 20):
                    digest.update(block)
            files.append(
                [
                    name,
                    uploaded.filename(),
                    uploaded.content_type(),
                    uploaded.size(),
                    digest.hexdigest(),
                ]
            )
            os.unlink(target)
    result = {
        "valid": request.valid_input(),
        "form": request.form(),
        "files": files,
        "held": len(
            [
                name
                for name in os.listdir(tempfile.gettempdir())
                if name.startswith("hyper-")
            ]
        ),
    }
    if usage:
        used = resource.getrusage(resource.RUSAGE_SELF)
        result["cpu"] = (used.ru_utime + used.ru_stime) * 1000
        result["rss"] = used.ru_maxrss
    return Response.text(200, json.dumps(result))


def shared(request: Request, reply: Reply) -> dict:
    loaded("shared", request)
    reply.note("stage", "shared")
    if os.environ.get("UPLOAD_GATE_AT") == "shared":
        gate("shared")
    return {}


def home(request: Request) -> dict:
    loaded("home", request)
    return {}


def item_page(request: Request) -> dict:
    loaded("item", request)
    return {}


def large(request: Request) -> dict:
    loaded("large", request)
    return {"filler": FILLER}


def rows(request: Request, reply: Reply) -> dict:
    if request.query_int("embed", 0) == 1:
        reply.embed_data()
    return {"items": ["a", "b"], "open": False}


def on_response(request, response, time, reply, failure) -> None:
    line(
        f"response {response.status} {mark(request)} elapsed={elapsed_of(time)}"
        f" failure={json.dumps(failure, ensure_ascii=False)} notes={notes_of(reply)}"
    )
    if os.environ.get("UPLOAD_HOOK") == "throws":
        raise RuntimeError("hook boom")


def on_disconnect(request, time, reply) -> None:
    line(
        f"disconnect {mark(request)} elapsed={elapsed_of(time)} notes={notes_of(reply)}"
    )


def written(request, response, ended, time, failure) -> None:
    line(
        f"written {'null' if response is None else response.status} {'true' if ended else 'false'} {mark(request)}"
        f" elapsed={elapsed_of(time)} failure={json.dumps(failure, ensure_ascii=False)}"
    )


app = App.open(
    manifest=os.path.join(application, "manifest.json"),
    program=os.path.join(application, "program"),
    handlers={
        **({} if log is None else {"shared": shared}),
        "routes": {
            "home": {"load": home},
            "item": {
                "load": item_page,
                "representations": {"application/vnd.example.item+json": item},
            },
            "large": {"load": large},
            "list": {"regions": {"rows": rows}},
            "add": {"post": lambda: Result.redirect("/")},
        },
    },
    timezone="Z",
    https=os.environ.get("UPLOAD_HTTPS") == "1",
    body_limit=limit,
    response_limit=16 * 1024 * 1024,
    form_types=["application/x-www-form-urlencoded", "multipart/form-data"],
    file_limit=limit,
    part_limit=int(os.environ.get("UPLOAD_PARTS", "1000")),
    on_response=None if log is None else on_response,
    on_disconnect=None if log is None else on_disconnect,
)
server = create_server(
    app,
    FileSessions(os.environ["UPLOAD_SESSIONS"]),
    files=os.environ.get("UPLOAD_FILES"),
    around=None if mode == "none" else around,
    written=None if log is None else written,
)
if log is not None:
    # The end of a request: the thread of its connection returned, after which every hook of the request has returned.
    process = server.process_request_thread

    def process_and_report(request, client_address) -> None:
        try:
            process(request, client_address)
        finally:
            print(f"ended {client_address[1]}", flush=True)

    server.process_request_thread = process_and_report
print(f"upload on http://127.0.0.1:{server.server_address[1]}", flush=True)
server.serve_forever()
