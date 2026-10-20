import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hyper, type HtmxApi, type HyperOptions } from '../src/hyper.js';
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

function client(fetch: Fetch): Hyper {
  const options: HyperOptions = { basePath: '/api', fetch, document: {} as never, currentUrl: () => 'http://localhost/' };
  return new Hyper(testApplication(), {} as HtmxApi, options);
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
      sent.push({ url, headers: { ...(init.headers as Record<string, string>) } });
      return responses.shift() ?? eventStream([], true);
    };
    const events: unknown[] = [];
    const errors: Error[] = [];
    client(fetch).subscribe('/api/events', { onEvent: (event) => events.push(event), onError: (error) => errors.push(error) });

    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ event: 'tick', data: 'a', id: '7' }]);
    expect(errors.map((error) => error.message)).toEqual([expect.stringContaining('ended')]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['Last-Event-ID']).toBeUndefined();

    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.url).toBe('/api/events');
    expect(sent[1]?.headers['Last-Event-ID']).toBe('7');
    await vi.advanceTimersByTimeAsync(0);
    expect(events[1]).toEqual({ event: 'message', data: 'b', id: '7' });
  });
});
