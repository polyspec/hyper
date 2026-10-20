import { createParser } from 'eventsource-parser';
import type { Fetch } from './obtain.js';

// The reconnection delay when the server sent no retry field (HYC-19).
const DEFAULT_RETRY_MS = 1000;
// The longest silence of the body before the stream fails (HYC-20).
export const DEFAULT_WATCHDOG_MS = 30000;

// One event of a subscription: its type, its data and the last event ID (HYC-18).
interface StreamEvent {
  event: string;
  data: string;
  id: string;
}

// Receives the events of a subscription and every failure of it (HYC-17, HYC-20).
export interface StreamListener {
  onEvent(event: StreamEvent): void;
  onError(error: Error): void;
}

export interface SubscribeOptions {
  watchdogMs?: number;
}

export interface Subscription {
  close(): void;
}

// The state of one subscription (HYC-17 to HYC-20). Each connection has its own AbortController, and a callback
// of a connection that is no longer the current one does nothing, so that an aborted connection reports nothing.
export class StreamSubscription {
  private lastEventId = '';
  private retryMs = DEFAULT_RETRY_MS;
  private closed = false;
  private attempt: AbortController | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  private readonly url: string;
  private readonly request: Fetch;
  private readonly listener: StreamListener;
  private readonly watchdogMs: number;

  constructor(url: string, request: Fetch, listener: StreamListener, watchdogMs: number) {
    this.url = url;
    this.request = request;
    this.listener = listener;
    this.watchdogMs = watchdogMs;
  }

  start(): void {
    this.connect();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.attempt?.abort();
  }

  private clearTimers(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    if (this.retry !== null) clearTimeout(this.retry);
    this.watchdog = null;
    this.retry = null;
  }

  private connect(): void {
    if (this.closed) return;
    const attempt = new AbortController();
    this.attempt = attempt;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.lastEventId !== '') headers['Last-Event-ID'] = this.lastEventId;
    this.read(attempt, headers).catch((error: unknown) => this.fail(attempt, error));
  }

  // Sends the request and reads the body of one connection; every failure goes to `fail`.
  private async read(attempt: AbortController, headers: Record<string, string>): Promise<void> {
    const response = await this.request(this.url, { method: 'GET', headers, credentials: 'same-origin', signal: attempt.signal });
    if (!this.isCurrent(attempt)) return;
    if (!response.ok) {
      await response.body?.cancel();
      this.fail(attempt, new Error(`the stream of ${this.url} answered with status ${response.status}`));
      return;
    }
    if (response.body === null) {
      this.fail(attempt, new Error(`the stream of ${this.url} has no body`));
      return;
    }
    // The fatal decoder turns a body that is not UTF-8 into a parse failure (HYC-18).
    const decoder = new TextDecoder('utf-8', { fatal: true });
    // The parser ignores an unknown field and an invalid retry value, which the standard says are not failures (HYC-18).
    const parser = createParser({
      onId: (id) => {
        this.lastEventId = id;
      },
      onRetry: (ms) => {
        this.retryMs = ms;
      },
      onEvent: (message) => {
        this.listener.onEvent({ event: message.event ?? 'message', data: message.data, id: this.lastEventId });
      },
    });
    const reader = response.body.getReader();
    this.arm(attempt);
    for (;;) {
      const { done, value } = await reader.read();
      if (!this.isCurrent(attempt)) return;
      if (done) {
        this.fail(attempt, new Error(`the stream of ${this.url} ended`));
        return;
      }
      this.arm(attempt);
      let text: string;
      try {
        text = decoder.decode(value, { stream: true });
      } catch (error) {
        this.fail(attempt, new Error(`the body of ${this.url} is not valid UTF-8: ${describe(error)}`, { cause: error }));
        return;
      }
      parser.feed(text);
    }
  }

  // Restarts the watchdog timer with each byte of the body (HYC-20).
  private arm(attempt: AbortController): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.fail(attempt, new Error(`no byte of ${this.url} arrived for ${this.watchdogMs} ms`));
    }, this.watchdogMs);
  }

  private isCurrent(attempt: AbortController): boolean {
    return !this.closed && this.attempt === attempt && !attempt.signal.aborted;
  }

  // Reports a failure of the current connection and reconnects after the retry delay (HYC-19, HYC-20).
  private fail(attempt: AbortController, cause: unknown): void {
    if (!this.isCurrent(attempt)) return;
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    attempt.abort();
    this.listener.onError(cause instanceof Error ? cause : new Error(describe(cause), { cause }));
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, this.retryMs);
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
