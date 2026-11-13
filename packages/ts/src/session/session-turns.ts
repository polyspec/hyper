// The turns of the requests of one process: a request waits for the earlier requests of its session in this process, so
// that they do not try the lock against each other (HY-104.17).

/** @internal */
export class SessionTurns {
  private readonly queues: Map<string, Promise<void>>;
  private readonly ends: Map<string, () => void>;

  constructor() {
    this.queues = new Map<string, Promise<void>>();
    this.ends = new Map<string, () => void>();
  }

  // Waits for the turn of an identifier, which lasts until `leave`.
  async enter(id: string): Promise<void> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(id, queued);
    await previous;
    this.ends.set(id, () => {
      this.ends.delete(id);
      release();
      if (this.queues.get(id) === queued) this.queues.delete(id);
    });
  }

  // Ends the turn of an identifier, so that the next request of its session in this process goes on.
  leave(id: string): void {
    const end = this.ends.get(id);
    if (end === undefined) throw new Error(`hyper: the session ${id} has no turn to end`);
    end();
  }
}
