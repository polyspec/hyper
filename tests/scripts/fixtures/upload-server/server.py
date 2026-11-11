"""The Python server of tests/scripts/upload-servers.test.mts: the `http.server` server of `create_server`, with the
application that the test built in UPLOAD_APP. The request hook answers every request with what the request gave of its
body as JSON: whether its input is valid, its form values, and the name, the filename, the content type, the size and
the SHA-256 digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of
requests in the temporary directory while the request runs. It prints the address that it listens on."""

import hashlib
import json
import os
import resource
import tempfile

from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server

application = os.environ["UPLOAD_APP"]
moved = os.environ["UPLOAD_MOVED"]
limit = int(os.environ["UPLOAD_LIMIT"])


def around(request, answer):
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


app = App.open(
    manifest=os.path.join(application, "manifest.json"),
    program=os.path.join(application, "program"),
    handlers={"routes": {"home": {"load": lambda: {}}}},
    timezone="Z",
    body_limit=limit,
    form_types=["application/x-www-form-urlencoded", "multipart/form-data"],
    file_limit=limit,
    part_limit=int(os.environ.get("UPLOAD_PARTS", "1000")),
)
server = create_server(app, FileSessions(os.environ["UPLOAD_SESSIONS"]), around=around)
print(f"upload on http://127.0.0.1:{server.server_address[1]}", flush=True)
server.serve_forever()
