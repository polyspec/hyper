"""One Python process that reads the request bodies of a list (tests/scripts/multipart-compare.test.mts): the arguments
are the list, a JSON file of objects with `body`, the path of the body, `type`, `chunk`, `limit`, `valueLimit`,
`partLimit` and `fileLimit`, and a directory for the files that it moves. It prints one JSON line for each body: what
the body gave, a digest of the names, the values, the filenames and the contents of the files, and what it used."""

import hashlib
import json
import os
import resource
import sys
import time

from polyspec.hyper.server._request_body import RequestBody

with open(sys.argv[1], encoding="utf-8") as listed:
    cases = json.load(listed)
for index, case in enumerate(cases):
    started = time.perf_counter()
    read = RequestBody(
        case["type"],
        case["limit"],
        True,
        case["valueLimit"],
        case["partLimit"],
        case["fileLimit"],
    )
    stopped = False
    with open(case["body"], "rb") as source:
        while not stopped:
            chunk = source.read(case["chunk"])
            if not chunk:
                break
            stopped = not read.feed(chunk)
    parts = read.parts()
    ms = (time.perf_counter() - started) * 1000
    digest = hashlib.sha256()
    values = files = size = 0
    if parts is not None:
        for name, items in parts[0].pairs():
            digest.update(b"V\0" + name.encode() + b"\0")
            for value in items:
                values += 1
                encoded = value.encode()
                digest.update(str(len(encoded)).encode() + b"\0" + encoded + b"\0")
        for name, items in parts[1].pairs():
            for uploaded in items:
                files += 1
                size += uploaded.size()
                target = os.path.join(sys.argv[2], f"python-{index}-{files}")
                uploaded.move_to(target)
                content = hashlib.sha256()
                with open(target, "rb") as moved:
                    while block := moved.read(1 << 20):
                        content.update(block)
                digest.update(
                    b"F\0"
                    + name.encode()
                    + b"\0"
                    + uploaded.filename().encode()
                    + b"\0"
                    + uploaded.content_type().encode()
                    + b"\0"
                    + str(uploaded.size()).encode()
                    + b"\0"
                    + content.hexdigest().encode()
                    + b"\0"
                )
                os.unlink(target)
    read.remove()
    usage = resource.getrusage(resource.RUSAGE_SELF)
    print(
        json.dumps(
            {
                "result": [
                    parts is not None,
                    stopped,
                    read.exceeded(),
                    values,
                    files,
                    size,
                    digest.hexdigest(),
                ],
                "ms": round(ms, 1),
                "cpu": round((usage.ru_utime + usage.ru_stime) * 1000),
            }
        )
    )
