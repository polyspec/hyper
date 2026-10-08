"""Stores board posts in an SQLite database, as src/Board/Posts.php does."""

from __future__ import annotations

import sqlite3
import threading
from typing import Callable, Optional


class Posts:
    """Reads and writes the posts table of one database file."""

    def __init__(self, file: str, now: Callable[[], int]):
        """Opens the database file and creates the posts table when it does not exist. `now` returns the creation
        time of a new post in Unix seconds."""
        self._now = now
        self._lock = threading.Lock()
        # The server answers requests in a thread of their own, so every query holds the lock of the posts.
        self._db = sqlite3.connect(file, check_same_thread=False)
        self._db.execute('''CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )''')
        self._db.commit()

    def page(self, page: int, per_page: int) -> list[dict]:
        """Returns one page of posts, newest first."""
        with self._lock:
            return self._page(page, per_page)

    def _page(self, page: int, per_page: int) -> list[dict]:
        rows = self._db.execute(
            'SELECT id, title, author, created_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?',
            (per_page, (page - 1) * per_page)).fetchall()
        return [{'id': row[0], 'title': row[1], 'author': row[2], 'created_at': row[3]} for row in rows]

    def find(self, identifier: int) -> Optional[dict]:
        """Returns one post, or None when it does not exist."""
        with self._lock:
            return self._find(identifier)

    def _find(self, identifier: int) -> Optional[dict]:
        row = self._db.execute('SELECT id, title, author, body, created_at FROM posts WHERE id = ?',
                               (identifier,)).fetchone()
        return None if row is None else {'id': row[0], 'title': row[1], 'author': row[2], 'body': row[3],
                                         'created_at': row[4]}

    def count(self) -> int:
        """Returns the number of posts."""
        with self._lock:
            return self._db.execute('SELECT COUNT(*) FROM posts').fetchone()[0]

    def page_count(self, per_page: int) -> int:
        """Returns the number of pages for a page size."""
        return (self.count() + per_page - 1) // per_page

    def create(self, title: str, author: str, body: str) -> int:
        """Creates a post and returns its id."""
        with self._lock:
            cursor = self._db.execute('INSERT INTO posts (title, author, body, created_at) VALUES (?, ?, ?, ?)',
                                      (title, author, body, self._now()))
            self._db.commit()
            return cursor.lastrowid
