// Stores the values of one session in memory, for one process.
import type { SessionStore } from './session-store.js';

export class ArraySession implements SessionStore {
  private readonly values: Map<string, unknown>;
  private renewed: number;

  constructor() {
    this.values = new Map<string, unknown>();
    this.renewed = 0;
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  // Counts the renewals; the values have no identifier in memory (HY-72).
  renew(): void {
    this.renewed++;
  }

  // Returns how many times the session was renewed.
  /** @internal */
  renewals(): number {
    return this.renewed;
  }
}
