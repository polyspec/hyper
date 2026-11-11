"""Stores board posts in an SQLite database, as src/Board/Posts.php does."""

from __future__ import annotations

import os
import sqlite3
import threading
from typing import Callable, Optional


class Posts:
    """Reads and writes the posts table of one database file."""

    def __init__(self, file: str, now: Callable[[], int]):
        """Opens the database file and creates the posts table when it does not exist. `now` returns the creation
        time of a new post in Unix seconds."""
        self._now = now
        self._file = file
        self._lock = threading.Lock()
        # The server answers requests in a thread of their own, so every query holds the lock of the posts.
        self._db = sqlite3.connect(file, check_same_thread=False)
        self._db.execute("""CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                attachment TEXT NOT NULL DEFAULT '',
                attachment_size INTEGER NOT NULL DEFAULT 0
            )""")
        # A table that an earlier version created has no columns of the attachment.
        columns = [row[1] for row in self._db.execute("PRAGMA table_info(posts)")]
        if "attachment" not in columns:
            self._db.execute(
                "ALTER TABLE posts ADD COLUMN attachment TEXT NOT NULL DEFAULT ''"
            )
            self._db.execute(
                "ALTER TABLE posts ADD COLUMN attachment_size INTEGER NOT NULL DEFAULT 0"
            )
        self._db.commit()

    def page(self, page: int, per_page: int) -> list[dict]:
        """Returns one page of posts, newest first."""
        with self._lock:
            return self._page(page, per_page)

    def _page(self, page: int, per_page: int) -> list[dict]:
        rows = self._db.execute(
            "SELECT id, title, author, created_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?",
            (per_page, (page - 1) * per_page),
        ).fetchall()
        return [
            {"id": row[0], "title": row[1], "author": row[2], "created_at": row[3]}
            for row in rows
        ]

    def find(self, identifier: int) -> Optional[dict]:
        """Returns one post, or None when it does not exist. `attachment` is the name and the size of its file, or
        None for a post without a file."""
        with self._lock:
            return self._find(identifier)

    def _find(self, identifier: int) -> Optional[dict]:
        row = self._db.execute(
            "SELECT id, title, author, body, created_at, attachment, attachment_size FROM posts WHERE id = ?",
            (identifier,),
        ).fetchone()
        return (
            None
            if row is None
            else {
                "id": row[0],
                "title": row[1],
                "author": row[2],
                "body": row[3],
                "created_at": row[4],
                "attachment": None
                if row[5] == ""
                else {"name": row[5], "size": row[6]},
            }
        )

    def count(self) -> int:
        """Returns the number of posts."""
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM posts").fetchone()[0]

    def page_count(self, per_page: int) -> int:
        """Returns the number of pages for a page size."""
        return (self.count() + per_page - 1) // per_page

    def create(
        self, title: str, author: str, body: str, attachment: str = "", size: int = 0
    ) -> int:
        """Creates a post and returns its id. `attachment` is the name of its file, or the empty string without a
        file, and `size` the number of bytes of the file."""
        with self._lock:
            cursor = self._db.execute(
                "INSERT INTO posts (title, author, body, created_at, attachment, attachment_size)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (title, author, body, self._now(), attachment, size),
            )
            self._db.commit()
            return cursor.lastrowid

    def attachment_path(self, identifier: int) -> str:
        """Returns the path of the file of a post in the directory `<database>.uploads`, which is created when it
        does not exist. An action moves an uploaded file to it (HY-131.15)."""
        directory = f"{self._file}.uploads"
        os.makedirs(directory, mode=0o700, exist_ok=True)
        return os.path.join(directory, str(identifier))
