// Stores the values of one browser session. `FileSessions` and `RedisSessions` give one store per request, and
// `ArraySession` keeps one session in memory.
export interface SessionStore {
  // Returns the value stored under a key, or undefined.
  get(key: string): unknown;
  // Stores a value under a key.
  set(key: string, value: unknown): void;
  // Removes the value stored under a key.
  remove(key: string): void;
  // Moves the values to a new session identifier and deletes the old session (HY-72).
  renew(): void;
}
