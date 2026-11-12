// The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104).
import { closeSync, constants, fstatSync, ftruncateSync, futimesSync, openSync, readSync, unlinkSync, writeSync } from 'node:fs';
import type { FileSessions } from './file-sessions.js';
import { RecordSession } from './record-session.js';

const OPEN = constants.O_RDWR | constants.O_NOFOLLOW;

/** @internal */
export class FileSession extends RecordSession {
  private readonly sessions: FileSessions;
  private readonly held: number | null;

  constructor(sessions: FileSessions, cookieId: string | null, held: number | null) {
    super(cookieId);
    this.sessions = sessions;
    this.held = held;
  }

  override stored(): Uint8Array | null {
    if (this.held === null || this.sessions.expired(fstatSync(this.held).mtimeMs)) return null;
    return FileSession.fileBytes(this.held);
  }

  // Writes a started session to its file, removes the file of a renewed identifier, and lets the next request of the
  // session start. A session that the request did not change keeps its bytes and takes a new modification time, as PHP
  // does with session.lazy_write.
  async close(): Promise<void> {
    try {
      const record = this.serialized();
      if (record === null || this.id === null) return;
      if (this.made) this.create(this.id, record);
      else if (this.held !== null) this.rewrite(this.held, record);
      if (this.renewed !== null) unlinkSync(this.sessions.file(this.renewed));
    } finally {
      try {
        if (this.held !== null) closeSync(this.held);
      } finally {
        if (this.held !== null && this.cookieId !== null) this.sessions.turns.leave(this.cookieId);
      }
    }
    return Promise.resolve();
  }

  // Creates the file of a new identifier with the mode 0600; no other process knows the identifier yet.
  private create(id: string, record: Uint8Array): void {
    const descriptor = openSync(this.sessions.file(id), OPEN | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      FileSession.writeBytes(descriptor, record);
    } finally {
      closeSync(descriptor);
    }
  }

  // Writes a record over the file of the session in place, under its lock, as PHP does.
  private rewrite(descriptor: number, record: Uint8Array): void {
    if (this.read !== null && Buffer.compare(this.read, record) === 0) {
      const now = new Date();
      futimesSync(descriptor, now, now);
      return;
    }
    FileSession.writeBytes(descriptor, record);
    ftruncateSync(descriptor, record.length);
  }

  // Returns the bytes of an open session file from its start.
  private static fileBytes(descriptor: number): Buffer {
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(1 << 20);
      const size = readSync(descriptor, chunk, 0, chunk.length, offset);
      if (size === 0) return Buffer.concat(chunks);
      chunks.push(chunk.subarray(0, size));
      offset += size;
    }
  }

  // Writes the bytes of a record at the start of an open session file.
  private static writeBytes(descriptor: number, record: Uint8Array): void {
    for (let offset = 0; offset < record.length; ) offset += writeSync(descriptor, record, offset, record.length - offset, offset);
  }
}
