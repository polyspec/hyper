// The session store of one request of the Redis sessions (HY-24, HY-45, HY-72, HY-115).
import type { RedisSessions } from './redis-sessions.js';
import { SessionLockError } from './session-lock-error.js';
import { RecordSession } from './record-session.js';

/** @internal */
export class RedisSession extends RecordSession {
  private readonly sessions: RedisSessions;
  private readonly secret: string | null;
  private readonly record: Uint8Array | null;

  constructor(sessions: RedisSessions, cookieId: string | null, secret: string | null, record: Uint8Array | null) {
    super(cookieId);
    this.sessions = sessions;
    this.secret = secret;
    this.record = record;
  }

  override stored(): Uint8Array | null {
    return this.record;
  }

  // Writes a started session, removes a renewed one and lets the next request of the session start. A request that lost
  // its lock writes nothing and fails. A session that the request did not change keeps its bytes and takes a new expiry,
  // as phpredis does with session.lazy_write.
  async close(): Promise<void> {
    const { sessions } = this;
    const held = this.cookieId === null ? null : sessions.key(this.cookieId);
    try {
      const record = this.serialized();
      if (record === null || this.id === null) return;
      const key = sessions.key(this.id);
      const lifetime = String(sessions.lifetime);
      if (!this.made && this.read !== null && Buffer.compare(this.read, record) === 0) {
        await sessions.command(['EXPIRE', key, lifetime]);
        return;
      }
      if (held !== null && this.secret !== null && !(await sessions.holds(held, this.secret))) {
        throw new SessionLockError(`hyper: the lock of the session ${held} expired`);
      }
      await sessions.command(['SETEX', key, lifetime, record]);
      if (this.renewed !== null) await sessions.command(['DEL', sessions.key(this.renewed)]);
    } finally {
      try {
        if (held !== null && this.secret !== null) await sessions.release(held, this.secret);
      } finally {
        if (this.cookieId !== null) this.sessions.turns.leave(this.cookieId);
      }
    }
  }
}
