// Stores board posts in an SQLite database, as src/Board/Posts.php does.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface PostRow {
  id: number;
  title: string;
  author: string;
  created_at: number;
}

export interface Post extends PostRow {
  body: string;
  // The name and the size of the file of the post, or null for a post without a file.
  attachment: { name: string; size: number } | null;
}

export class Posts {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly file: string;

  // Opens the database file and creates the posts table when it does not exist. `now` returns the creation time
  // of a new post in Unix seconds.
  constructor(file: string, now: () => number) {
    this.now = now;
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                attachment TEXT NOT NULL DEFAULT '',
                attachment_size INTEGER NOT NULL DEFAULT 0
            )`);
    // A table that an earlier version created has no columns of the attachment.
    if (!this.db.prepare('PRAGMA table_info(posts)').all().some((column) => column.name === 'attachment')) {
      this.db.exec("ALTER TABLE posts ADD COLUMN attachment TEXT NOT NULL DEFAULT ''");
      this.db.exec('ALTER TABLE posts ADD COLUMN attachment_size INTEGER NOT NULL DEFAULT 0');
    }
  }

  // Returns one page of posts, newest first.
  page(page: number, perPage: number): PostRow[] {
    const rows = this.db.prepare('SELECT id, title, author, created_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?').all(perPage, (page - 1) * perPage);
    return rows.map((row) => ({ id: Number(row.id), title: String(row.title), author: String(row.author), created_at: Number(row.created_at) }));
  }

  // Returns one post, or null when it does not exist.
  find(id: bigint): Post | null {
    const row = this.db.prepare('SELECT id, title, author, body, created_at, attachment, attachment_size FROM posts WHERE id = ?').get(id);
    if (row === undefined) return null;
    const attachment = String(row.attachment) === '' ? null : { name: String(row.attachment), size: Number(row.attachment_size) };
    return { id: Number(row.id), title: String(row.title), author: String(row.author), body: String(row.body), created_at: Number(row.created_at), attachment };
  }

  // Returns the number of posts.
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM posts').get();
    if (row === undefined) throw new Error('SELECT COUNT(*) returned no row');
    return Number(row.count);
  }

  // Returns the number of pages for a page size.
  pageCount(perPage: number): number {
    return Math.floor((this.count() + perPage - 1) / perPage);
  }

  // Creates a post and returns its id. `attachment` is the name of its file, or the empty string without a file, and
  // `size` the number of bytes of the file.
  create(title: string, author: string, body: string, attachment = '', size = 0): number {
    const result = this.db.prepare('INSERT INTO posts (title, author, body, created_at, attachment, attachment_size) VALUES (?, ?, ?, ?, ?, ?)').run(title, author, body, this.now(), attachment, size);
    return Number(result.lastInsertRowid);
  }

  // Returns the path of the file of a post in the directory `<database>.uploads`, which is created when it does not
  // exist. An action moves an uploaded file to it (HY-131.15).
  attachmentPath(id: number): string {
    const directory = `${this.file}.uploads`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return join(directory, String(id));
  }
}
