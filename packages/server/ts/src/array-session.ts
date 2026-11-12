// Stores the values of one session in memory, for one process.
import type { SessionStore } from './session-store.js';
import { ArgumentCountError } from './argument-count-error.js';

export class ArraySession implements SessionStore {
  private readonly values: Map<string, unknown>;
  private renewed: number;

  constructor() {
    ArgumentCountError.between(arguments.length, 0, 0);
    this.values = new Map<string, unknown>();
    this.renewed = 0;
  }

  get(key: string): unknown {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    ArgumentCountError.between(arguments.length, 2, 2);
    this.values.set(key, value);
  }

  remove(key: string): void {
    ArgumentCountError.between(arguments.length, 1, 1);
    this.values.delete(key);
  }

  // Counts the renewals; the values have no identifier in memory (HY-72).
  renew(): void {
    ArgumentCountError.between(arguments.length, 0, 0);
    this.renewed++;
  }

  // Returns how many times the session was renewed.
  /** @internal */
  renewals(): number {
    return this.renewed;
  }
}
