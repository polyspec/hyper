<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Examples\Board;

use PDO;

/** Stores board posts in an SQLite database. */
final class Posts
{
    private readonly PDO $db;

    /**
     * Opens the database file and creates the posts table when it does not exist. `$now` returns the creation time
     * of a new post in Unix seconds.
     */
    public function __construct(string $file, private readonly \Closure $now)
    {
        $this->db = new PDO("sqlite:{$file}", options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )'
        );
    }

    /**
     * Returns one page of posts, newest first.
     *
     * @return list<array{id: int, title: string, author: string, created_at: int}>
     */
    public function page(int $page, int $perPage): array
    {
        $statement = $this->db->prepare(
            'SELECT id, title, author, created_at FROM posts ORDER BY id DESC LIMIT :limit OFFSET :offset'
        );
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $statement->execute();

        return array_map(fn (array $row): array => [
            'id' => (int) $row['id'],
            'title' => (string) $row['title'],
            'author' => (string) $row['author'],
            'created_at' => (int) $row['created_at'],
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * Returns one post, or null when it does not exist.
     *
     * @return array{id: int, title: string, author: string, body: string, created_at: int}|null
     */
    public function find(int $id): ?array
    {
        $statement = $this->db->prepare('SELECT id, title, author, body, created_at FROM posts WHERE id = ?');
        $statement->execute([$id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row === false ? null : [
            'id' => (int) $row['id'],
            'title' => (string) $row['title'],
            'author' => (string) $row['author'],
            'body' => (string) $row['body'],
            'created_at' => (int) $row['created_at'],
        ];
    }

    /** Returns the number of posts. */
    public function count(): int
    {
        return (int) $this->db->query('SELECT COUNT(*) FROM posts')->fetchColumn();
    }

    /** Returns the number of pages for a page size. */
    public function pageCount(int $perPage): int
    {
        return intdiv($this->count() + $perPage - 1, $perPage);
    }

    /** Creates a post and returns its id. */
    public function create(string $title, string $author, string $body): int
    {
        $statement = $this->db->prepare('INSERT INTO posts (title, author, body, created_at) VALUES (?, ?, ?, ?)');
        $statement->execute([$title, $author, $body, ($this->now)()]);

        return (int) $this->db->lastInsertId();
    }
}
