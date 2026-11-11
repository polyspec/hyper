"""The Python server of tests/scripts/upload-servers.test.mts: the `http.server` server of `create_server`, with the
application that the test built in UPLOAD_APP. The request hook answers every request with what the request gave of its
body as JSON: whether its input is valid, its form values, and the name, the filename, the content type, the size and
the SHA-256 digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of
requests in the temporary directory while the request runs. It prints the address that it listens on."""

import hashlib
import json
import os
import tempfile

from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server

application = os.environ["UPLOAD_APP"]
moved = os.environ["UPLOAD_MOVED"]
limit = int(os.environ["UPLOAD_LIMIT"])


def around(request, answer):
    files = []
    for name, items in request.files():
        for uploaded in items:
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
    return Response.text(
        200,
        json.dumps(
            {
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
        ),
    )


app = App.open(
    manifest=os.path.join(application, "manifest.json"),
    program=os.path.join(application, "program"),
    handlers={"routes": {"home": {"load": lambda: {}}}},
    timezone="Z",
    body_limit=limit,
    form_types=["application/x-www-form-urlencoded", "multipart/form-data"],
    file_limit=limit,
)
server = create_server(app, FileSessions(os.environ["UPLOAD_SESSIONS"]), around=around)
print(f"upload on http://127.0.0.1:{server.server_address[1]}", flush=True)
server.serve_forever()
