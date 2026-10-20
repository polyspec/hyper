import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hyper, type DocumentAdapter, type HtmxApi, type HyperOptions } from '../src/hyper.js';
import type { Fetch } from '../src/obtain.js';
import { testApplication } from './application.js';

// A body that sends each chunk, and ends the stream when `end` is set.
function body(chunks: string[], end: boolean): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (end) controller.close();
    },
  });
}

function eventStream(chunks: string[], end: boolean): Response {
  return new Response(body(chunks, end), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const idlePage: DocumentAdapter = {
  stylesheets: async () => () => undefined,
  mount: () => undefined,
  text: () => undefined,
  fail: () => undefined,
  elements: () => 0,
};
const idleHtmx: HtmxApi = { process: () => undefined, swap: async () => undefined, find: () => null, config: { defaultTimeout: 60000 }, parseInterval: Number };

function client(fetch: Fetch): Hyper {
  const options: HyperOptions = { basePath: '/api', fetch, document: idlePage, currentUrl: () => 'http://localhost/' };
  return new Hyper(testApplication(), idleHtmx, options);
}

describe('client stream subscription', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects with Last-Event-ID and the server retry delay', async () => {
    vi.useFakeTimers();
    const sent: { url: string; headers: Record<string, string> }[] = [];
    const responses = [eventStream(['retry: 250\nid: 7\nevent: tick\ndata: a\n\n'], true), eventStream(['data: b\n\n'], true)];
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, headers: Object.fromEntries(new Headers(init.headers)) });
      return responses.shift() ?? eventStream([], true);
    };
    const events: unknown[] = [];
    const errors: Error[] = [];
    client(fetch).subscribe('/api/events', { onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });

    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ event: 'tick', data: 'a', id: '7' }]);
    expect(errors.map((error) => error.message)).toEqual([expect.stringContaining('ended')]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['last-event-id']).toBeUndefined();

    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.url).toBe('/api/events');
    expect(sent[1]?.headers['last-event-id']).toBe('7');
    await vi.advanceTimersByTimeAsync(0);
    expect(events[1]).toEqual({ event: 'message', data: 'b', id: '7' });
  });

  it('reports a silent stream and reconnects', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const responses = [new Response(silent, { status: 200 }), eventStream(['data: after\n\n'], true)];
    const fetch: Fetch = async (url) => {
      sent.push(url);
      return responses.shift() ?? eventStream([], true);
    };
    const events: unknown[] = [];
    const errors: Error[] = [];
    client(fetch).subscribe('/api/events', { onEvent: (event) => events.push(event), onError: (error) => errors.push(error) }, { watchdogMs: 1000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(errors).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors.map((error) => error.message)).toEqual([expect.stringContaining('no byte of /api/events arrived for 1000 ms')]);
    expect(sent).toHaveLength(1);

    // The retry delay of the stream is the default of 1000 ms, since the server sent none.
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ event: 'message', data: 'after', id: '' }]);
  });

  it('dispose aborts subscriptions and pending requests', async () => {
    vi.useFakeTimers();
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const signals: AbortSignal[] = [];
    const fetch: Fetch = async (_url, init) => {
      if (init.signal) signals.push(init.signal);
      // The first response is silent, so its watchdog timer is running when the client is disposed.
      if (signals.length === 1) return new Response(silent, { status: 200 });
      return new Promise<Response>(() => undefined);
    };
    const events: unknown[] = [];
    const errors: Error[] = [];
    const listener = { onEvent: (event: unknown) => events.push(event), onError: (error: Error) => errors.push(error) };
    const hyper = client(fetch);
    hyper.subscribe('/api/events', listener, { watchdogMs: 1000 });
    hyper.subscribe('/api/other', listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    hyper.dispose();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => hyper.subscribe('/api/events', listener)).toThrow();
    hyper.dispose();

    await vi.advanceTimersByTimeAsync(60000);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(signals).toHaveLength(2);
  });

  it('fails a silent stream after the default watchdog of 30000 ms', async () => {
    vi.useFakeTimers();
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const fetch: Fetch = async () => new Response(silent, { status: 200 });
    const errors: Error[] = [];
    client(fetch).subscribe('/api/events', { onEvent: () => undefined, onError: (error) => errors.push(error) });

    await vi.advanceTimersByTimeAsync(29999);
    expect(errors).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors.map((error) => error.message)).toEqual([expect.stringContaining('arrived for 30000 ms')]);
  });
});
