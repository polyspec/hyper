// Stores board posts in an SQLite database, as src/Board/Posts.php does.
import { DatabaseSync } from 'node:sqlite';

export interface PostRow {
  id: number;
  title: string;
  author: string;
  created_at: number;
}

export interface Post extends PostRow {
  body: string;
}

export class Posts {
  private readonly db: DatabaseSync;

  // Opens the database file and creates the posts table when it does not exist. `now` returns the creation time
  // of a new post in Unix seconds.
  constructor(file: string, private readonly now: () => number) {
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )`);
  }

  // Returns one page of posts, newest first.
  page(page: number, perPage: number): PostRow[] {
    const rows = this.db.prepare('SELECT id, title, author, created_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?').all(perPage, (page - 1) * perPage);
    return rows.map((row) => ({ id: Number(row.id), title: String(row.title), author: String(row.author), created_at: Number(row.created_at) }));
  }

  // Returns one post, or null when it does not exist.
  find(id: bigint): Post | null {
    const row = this.db.prepare('SELECT id, title, author, body, created_at FROM posts WHERE id = ?').get(id);
    return row === undefined ? null : { id: Number(row.id), title: String(row.title), author: String(row.author), body: String(row.body), created_at: Number(row.created_at) };
  }

  // Returns the number of posts.
  count(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM posts').get()!.count);
  }

  // Returns the number of pages for a page size.
  pageCount(perPage: number): number {
    return Math.floor((this.count() + perPage - 1) / perPage);
  }

  // Creates a post and returns its id.
  create(title: string, author: string, body: string): number {
    const result = this.db.prepare('INSERT INTO posts (title, author, body, created_at) VALUES (?, ?, ?, ?)').run(title, author, body, this.now());
    return Number(result.lastInsertRowid);
  }
}
