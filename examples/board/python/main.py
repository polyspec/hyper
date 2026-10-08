"""Serves the board example with the Python server, as public/index.php serves it with PHP and node/main.ts with
Node.js.

Environment: BOARD_DB (the SQLite database file), BOARD_SESSIONS (an absolute session directory), BOARD_PORT (0
lets the system assign the port; the server prints the port that it listens on), and as for PHP BOARD_BASE_PATH,
BOARD_HTTPS=1, BOARD_FRAME_ANCESTORS (HY-45) and BOARD_TIME.

Usage: python3 examples/board/python/main.py   (the working directory holds packages/hyper-python/src on
PYTHONPATH, which `make server-parity-python` sets)."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server

from handlers import Services, handlers
from posts import Posts

BOARD = Path(__file__).resolve().parent.parent


def env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == '':
        raise RuntimeError(f'{name} is required')
    return value


def _services() -> Services:
    """Returns the services of the board: its posts and the URLs of its assets."""
    # BOARD_TIME fixes the creation time of new posts in Unix seconds, so that two servers store the same posts
    # (`make server-parity`); without it a post has the current time.
    fixed = os.environ.get('BOARD_TIME') or ''
    if fixed != '' and re.fullmatch(r'[0-9]{1,15}', fixed) is None:
        raise RuntimeError('BOARD_TIME must be Unix seconds')
    now = (lambda: int(fixed)) if fixed != '' else (lambda: int(time.time()))
    manifest = BOARD / 'build' / 'manifest.json'
    urls = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(urls.get('hyper'), str):
        raise RuntimeError(f'the asset manifest {manifest} has no hyper URL; run make assets')
    return Services(Posts(database, now), urls['hyper'])


database = env('BOARD_DB')
port = int(env('BOARD_PORT'))
session_directory = Path(env('BOARD_SESSIONS'))
session_directory.mkdir(parents=True, exist_ok=True)

application = App.open(
    manifest=str(BOARD / 'app' / 'app.json'),
    # `make server` builds the program, whose templates directory and reads.json the Python server reads (HY-48).
    program=str(BOARD / 'build' / 'server'),
    handlers=handlers(_services()),
    timezone='+09:00',
    base_path=os.environ.get('BOARD_BASE_PATH') or '',
    https=os.environ.get('BOARD_HTTPS') == '1',
    frame_ancestors=os.environ.get('BOARD_FRAME_ANCESTORS') or "'self'",
)
server = create_server(application, FileSessions(str(session_directory)), files=str(BOARD / 'public'), port=port)
print(f'board on http://127.0.0.1:{server.server_address[1]}', flush=True)
server.serve_forever()
