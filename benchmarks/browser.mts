// Measures the board example in Chromium: the first screen in SSR and CSR, a region navigation, the
// re-render of hy-set as the number of rows grows with its script, style and layout load, the template
// engine alone, memory over repeated navigation, template loading and the transferred bytes. It starts its own servers
// with scripts/board-servers.mts on ports that the system assigns and its own database in a temporary directory of
// the run, which it removes.
//
// Usage: node benchmarks/browser.mts --runs 15

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import type { Browser, CDPSession } from '@playwright/test';
import { serverRun, startBoard } from '../scripts/board-servers.mts';
import { isJsonObject, jsonArray, jsonObject, jsonObjects, jsonString, parseJsonObject } from '../scripts/json.mts';

// The globals of the board page that the measurements read: the Hyper instance and htmx of examples/board/client/main.ts
// (examples/board/client/window.d.ts), and the marks and posts that this script sets.
declare global {
  interface Window {
    benchMarks: Record<string, number>;
    benchPosts: unknown[];
  }
}
type Kind = 'script' | 'style' | 'layout' | 'paint' | 'gc';
// An event of a Chromium trace; a complete event (ph X) has a duration.
// The fields of an event that the load reads; threadName is the name of args of a thread_name event.
interface TraceEvent { ph?: string | undefined; name?: string | undefined; pid?: number | undefined; tid?: number | undefined; ts?: number | undefined; dur?: number | undefined; threadName?: string | undefined }
interface Span { name: string; ts: number; dur: number; children: number }
interface LongTask { duration: number; parts: [string, number][] }
type Load = Record<Kind | 'total' | 'other' | 'longest' | 'long', number> & { longTasks: LongTask[] };
interface HeapEntry { count: number; size: number }
interface HeapSnapshot {
  snapshot: { meta: { node_fields: string[]; node_types: [string[], ...unknown[]]; edge_fields: string[] } };
  nodes: number[];
  edges: number[];
  strings: string[];
}

const { values } = parseArgs({ options: { runs: { type: 'string' } } });
if (!values.runs) throw new Error('--runs is required');
const runs = Number(values.runs);
const TRACE_CATEGORIES = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink.user_timing'];
const PHASES = ['total', 'hyper', 'template', 'parse', 'morph', 'settle', 'process', 'events'];

// Runs hy-set changes in the page with timers around the template engine, htmx.swap and htmx.process,
// and around the htmx swap events, and returns the summed milliseconds of each phase:
// hyper is the change outside rendering and swapping (data copy, hold, store), parse is from the swap
// call to htmx:before:swap, morph is to htmx:before:settle, settle is to htmx:after:settle, process is
// htmx.process of the new content, and events is the rest of the swap.
async function attributeChange({ runs, path, values }: { runs: number; path: string; values: unknown[] }): Promise<Record<string, number>> {
  const { hyper, htmx } = window;
  const engine = hyper.app.engine;
  const sum = { total: 0, hyper: 0, template: 0, parse: 0, morph: 0, settle: 0, process: 0, events: 0 };
  const at: Record<string, number> = {};
  // The time of a mark of this run; a mark that did not happen is an error, not a NaN.
  const time = (name: string): number => {
    const value = at[name];
    if (value === undefined) throw new Error(`the change of ${path} did not reach ${name}`);
    return value;
  };
  const listeners = ['htmx:before:swap', 'htmx:before:settle', 'htmx:after:settle'].map((name): [string, () => void] => {
    const listener = () => { at[name] ??= performance.now(); };
    document.addEventListener(name, listener, true);
    return [name, listener];
  });
  // Each timer is an own property of the object. The finally block restores the own property that the object had before,
  // or deletes the timer when the method came from the prototype, so the object is as it was in either case.
  const owned = (target: object, name: string) => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) });
  const restores = [owned(engine, 'render'), owned(htmx, 'swap'), owned(htmx, 'process')];
  const render = engine.render.bind(engine);
  engine.render = (...args: Parameters<typeof render>) => {
    const start = performance.now();
    try { return render(...args); } finally { sum.template += performance.now() - start; }
  };
  const swap = htmx.swap.bind(htmx);
  const process = htmx.process.bind(htmx);
  htmx.swap = async (...args: Parameters<typeof swap>) => {
    at.swap = performance.now();
    try { return await swap(...args); } finally { at.swapped = performance.now(); }
  };
  let depth = 0;
  let processStart = 0;
  htmx.process = (...args: Parameters<typeof process>) => {
    if (depth++ === 0) processStart = performance.now();
    try { return process(...args); } finally { if (--depth === 0) sum.process += performance.now() - processStart; }
  };
  try {
    for (let run = 0; run < runs; run++) {
      for (const key of Object.keys(at)) delete at[key];
      const processBefore = sum.process;
      const templateBefore = sum.template;
      const start = performance.now();
      await hyper.set('rows', path, values[run % 2]);
      const total = performance.now() - start;
      const swapTime = time('swapped') - time('swap');
      sum.total += total;
      sum.hyper += total - swapTime - (sum.template - templateBefore);
      sum.parse += time('htmx:before:swap') - time('swap');
      sum.morph += time('htmx:before:settle') - time('htmx:before:swap');
      sum.settle += time('htmx:after:settle') - time('htmx:before:settle');
      sum.events += time('swapped') - time('htmx:after:settle') - (sum.process - processBefore);
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    }
  } finally {
    for (const { target, name, descriptor } of restores) {
      if (descriptor === undefined) Reflect.deleteProperty(target, name);
      else Object.defineProperty(target, name, descriptor);
    }
    for (const [name, listener] of listeners) document.removeEventListener(name, listener, true);
  }
  return sum;
}

const KINDS: [Kind, RegExp][] = [
  ['style', /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet)$/],
  ['layout', /^(Layout|UpdateLayout)$/],
  ['paint', /^(PrePaint|Paint|PaintImage|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit)$/],
  ['gc', /GC|Scavenge|MarkCompact/],
  ['script', /^(FunctionCall|EvaluateScript|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|V8\.|v8\.)/],
];
const run = serverRun('hyper-bench-browser-');
console.log(`run directory: ${run.directory}`);

// The item at `fraction` of the sorted items; no item is an error.
const quantile = (items: number[], fraction: number): number => {
  const value = [...items].sort((a, b) => a - b)[Math.floor(items.length * fraction)];
  if (value === undefined) throw new Error('a measurement has no sample');
  return value;
};
const median = (items: number[]): number => quantile(items, 0.5);
const p95 = (items: number[]): number => quantile(items, 0.95);
const row = (label: string, items: number[], unit = 'ms'): string => `| ${label} | ${median(items).toFixed(2)} | ${p95(items).toFixed(2)} | ${unit} |`;

// Records when the first #content h1 with a given text appears, measured from navigation start.
const observer = (): void => {
  const page = window;
  page.benchMarks = {};
  new MutationObserver(() => {
    const heading = document.querySelector('#content h1')?.textContent;
    if (heading && page.benchMarks[heading] === undefined) page.benchMarks[heading] = performance.now();
  }).observe(document, { childList: true, subtree: true, characterData: true });
};

let browser: Browser | undefined;
try {
  const board = await startBoard({ app: 'examples/board', database: join(run.directory, 'board.db'), ports: { ssr: 0, edge: 0, api: 0 }, children: run.children });
  const ssr = board.ssr;
  const csr = board.edge;
  await seed(ssr, 30);
  const launched = await chromium.launch();
  browser = launched;
  const lines = ['| Measurement | median | p95 | unit |', '|---|---:|---:|---|'];

  const origins: [string, string][] = [['SSR', ssr], ['CSR', csr]];
  for (const [label, origin] of origins) {
    const first: number[] = [];
    const navigation: number[] = [];
    for (let run = 0; run < runs; run++) {
      const context = await launched.newContext();
      const page = await context.newPage();
      await page.addInitScript(observer);
      await page.goto(`${origin}/board`);
      await page.waitForFunction(() => window.benchMarks['게시판'] !== undefined && document.getElementById('rows') !== null);
      first.push(await page.evaluate(() => {
        const mark = window.benchMarks['게시판'];
        if (mark === undefined) throw new Error('the list heading has no mark');
        return mark;
      }));
      await page.waitForLoadState('networkidle');
      const start = await page.evaluate(() => {
        const at = performance.now();
        const link = document.querySelector<HTMLAnchorElement>('a[href="/board/create"]');
        if (link === null) throw new Error('the page has no link to /board/create');
        link.click();
        return at;
      });
      await page.waitForFunction(() => window.benchMarks['글쓰기'] !== undefined);
      navigation.push((await page.evaluate(() => {
        const mark = window.benchMarks['글쓰기'];
        if (mark === undefined) throw new Error('the create heading has no mark');
        return mark;
      })) - start);
      await context.close();
    }
    lines.push(row(`${label}: first screen of /board (navigation start to list heading)`, first));
    lines.push(row(`${label}: region navigation to /board/create (click to heading)`, navigation));
  }

  const context = await launched.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${ssr}/board`);
  // The rows element exists once the server or the browser rendered the list; a server-rendered list holds no data
  // until it needs it (HYC-7).
  await page.waitForFunction(() => document.getElementById('rows') !== null);
  await page.waitForLoadState('networkidle');
  const load: string[] = [];
  const attribution: string[] = [];
  const longTasks: string[] = [];
  for (const count of [10, 100, 1000]) {
    await page.evaluate(async (count) => {
      const bench = window;
      bench.benchPosts = Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `게시글 ${index} <제목>`, author: `작성자 ${index}`, created_at: 1790000000 + index }));
      await bench.hyper.render('rows', { posts: bench.benchPosts, sort: '', compact: false, highlight: null });
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    }, count);
    await launched.startTracing(page, { categories: TRACE_CATEGORIES });
    // Each change runs in its own task and is followed by a rendered frame, as a click would be.
    const set = await page.evaluate(async (runs) => {
      const times: number[] = [];
      for (let run = 0; run < runs; run++) {
        const at = performance.now();
        await window.hyper.set('rows', 'sort', run % 2 === 0 ? 'title' : '');
        times.push(performance.now() - at);
        await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
      }
      return times;
    }, runs);
    const trace = mainThreadLoad(traceEvents((await launched.stopTracing()).toString()));
    await cdp.send('HeapProfiler.collectGarbage');
    const nodes = metric(await metrics(cdp), 'Nodes');
    const engine = await page.evaluate((runs) => {
      const bench = window;
      const assign = { title: '게시판', posts: bench.benchPosts, sort: 'title', compact: false, highlight: null };
      const times: number[] = [];
      for (let run = 0; run < runs; run++) {
        const at = performance.now();
        bench.hyper.app.engine.render('board/rows.tpl', assign, { env: { timezone: '+09:00' } });
        times.push(performance.now() - at);
      }
      return times;
    }, runs);
    const changes: [string, string, unknown[]][] = [['sort (reorders every row)', 'sort', ['title', '']], ['compact (keeps the row order)', 'compact', [true, false]]];
    for (const [label, path, values] of changes) {
      const phases = await page.evaluate(attributeChange, { runs, path, values });
      attribution.push(`| ${count} | ${label} | ${PHASES.map((name) => (metric(phases, name) / runs).toFixed(2)).join(' | ')} |`);
    }
    longTasks.push(...trace.longTasks.map((task) => `| ${count} | ${task.duration.toFixed(1)} | ${task.parts.map(([name, ms]) => `${name} ${ms.toFixed(1)}`).join(', ')} |`));
    lines.push(row(`hy-set re-render of the rows region, ${count} rows (data change to DOM)`, set));
    lines.push(row(`template engine alone, board/rows.tpl, ${count} rows`, engine));
    const per = (name: Kind | 'total' | 'other'): string => (trace[name] / runs).toFixed(2);
    load.push(`| ${count} | ${per('total')} | ${per('script')} | ${per('style')} | ${per('layout')} | ${per('paint')} | ${per('gc')} | ${per('other')} | ${trace.longest.toFixed(1)} | ${trace.long} | ${nodes} |`);
  }
  await context.close();
  await context.close();

  const memory = await navigationMemory(launched, ssr, 200);
  const csrContext = await launched.newContext();
  const csrPage = await csrContext.newPage();
  await csrPage.goto(`${csr}/board`);
  await csrPage.waitForLoadState('networkidle');
  const templates = await csrPage.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && entry.name.includes('/assets/templates/'))
    .map((entry) => ({ duration: entry.duration, bytes: entry.encodedBodySize })));
  lines.push(`| CSR: template files loaded for /board | ${templates.length} | | files |`);
  lines.push(`| CSR: template loading, slowest file (first visit, local server) | ${Math.max(...templates.map((item) => item.duration)).toFixed(2)} | | ms |`);
  await csrContext.close();

  const sizes: string[] = [];
  const responses: [string, Record<string, string>][] = [['/board document HTML', {}], ['/board region JSON', { Accept: 'application/json', 'HX-Request': 'true', 'HX-Current-URL': `${ssr}/` }]];
  for (const [label, headers] of responses) {
    const body = Buffer.from(await (await fetch(`${ssr}/board`, { headers })).arrayBuffer());
    sizes.push(`| ${label} | ${body.length} | ${gzipSync(body, { level: 9 }).length} |`);
  }

  console.log(lines.join('\n'));
  console.log('\n| Response | bytes | gzip bytes |\n|---|---:|---:|');
  console.log(sizes.join('\n'));
  console.log('\n## Main thread load of one hy-set (per change including its frame, Chromium trace, ms)\n\n| Rows | main thread ms | script | style | layout | paint | GC | other | longest task ms | tasks over 50 ms | DOM nodes after GC |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  console.log(load.join('\n'));
  console.log(`\n## Where one hy-set change spends its time (per change, ms)\n\n| Rows | change | ${PHASES.join(' | ')} |\n|---:|---|${PHASES.map(() => '---:').join('|')}|`);
  console.log(attribution.join('\n'));
  console.log('\n## Tasks over 50 ms during hy-set changes, with their largest parts (self time, ms)\n\n| Rows | task ms | parts |\n|---:|---:|---|');
  console.log(longTasks.length ? longTasks.join('\n') : '| - | - | none |');
  console.log('\n## Memory over repeated navigation (SSR, /board → /board/create → /board/<id> → /board, after forced GC)\n\n| Cycles | JS heap used KB | DOM nodes | event listeners | documents |\n|---:|---:|---:|---:|---:|');
  console.log(memory.rows.join('\n'));
  console.log(`\n## Heap growth from cycle ${memory.from} to cycle ${memory.to}, largest first\n\n| type: constructor or name | count | self bytes | first retainers of one instance |\n|---|---:|---:|---|`);
  console.log(memory.growth.length ? memory.growth.join('\n') : '| none | 0 | 0 |');
  console.log(`\n${runs} runs per measurement, Chromium ${launched.version()}, Node ${process.version}`);
} finally {
  await browser?.close();
  await run.close();
}

// Sums the self time of every event on the renderer main thread by kind, so that a style recalculation
// forced inside a script counts as style and not as script. Returns milliseconds.
function mainThreadLoad(events: TraceEvent[]): Load {
  const names = events.filter((event) => event.ph === 'M' && event.name === 'thread_name' && event.threadName === 'CrRendererMain');
  const busiest = names
    .map((thread) => ({ thread, count: events.filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.name === 'RunTask').length }))
    .sort((a, b) => b.count - a.count)[0]?.thread;
  if (busiest === undefined) throw new Error('the trace has no renderer main thread CrRendererMain');
  const complete: Span[] = events
    .filter((event): event is TraceEvent & { name: string; ts: number; dur: number } => event.pid === busiest.pid && event.tid === busiest.tid && event.ph === 'X'
      && typeof event.name === 'string' && typeof event.ts === 'number' && typeof event.dur === 'number')
    .map((event) => ({ name: event.name, ts: event.ts, dur: event.dur, children: 0 }))
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const load: Load = { total: 0, script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0, longest: 0, long: 0, longTasks: [] };
  const long: Span[] = [];
  const stack: Span[] = [];
  for (const event of complete) {
    for (let top = stack.at(-1); top !== undefined && top.ts + top.dur <= event.ts; top = stack.at(-1)) stack.pop();
    const parent = stack.at(-1);
    if (parent !== undefined) parent.children += event.dur;
    else if (event.name === 'RunTask') {
      load.total += event.dur / 1000;
      load.longest = Math.max(load.longest, event.dur / 1000);
      if (event.dur > 50000) {
        load.long++;
        long.push(event);
      }
    }
    stack.push(event);
  }
  for (const event of complete) {
    const kind = KINDS.find(([, pattern]) => pattern.test(event.name))?.[0] ?? 'other';
    load[kind] += (event.dur - event.children) / 1000;
  }
  for (const task of long) {
    const parts = new Map<string, number>();
    for (const event of complete) {
      if (event.ts < task.ts || event.ts >= task.ts + task.dur) continue;
      parts.set(event.name, (parts.get(event.name) ?? 0) + (event.dur - event.children) / 1000);
    }
    load.longTasks.push({ duration: task.dur / 1000, parts: [...parts].sort((a, b) => b[1] - a[1]).slice(0, 6) });
  }
  return load;
}

// Takes a heap snapshot after garbage collection and returns the count and self size of the nodes
// grouped by type and constructor name, and the first retainer chain of one node of every group.
async function heapCounts(cdp: CDPSession): Promise<{ counts: Map<string, HeapEntry>; retainers: Map<string, string[]> }> {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks: string[] = [];
  const collect = ({ chunk }: { chunk: string }): void => { chunks.push(chunk); };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', collect);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', collect);
  const snapshot = heapSnapshot(chunks.join(''));
  const fields = snapshot.snapshot.meta.node_fields;
  const types = snapshot.snapshot.meta.node_types[0];
  // The value of a field of the heap snapshot; an index outside the snapshot is an error.
  const at = <T,>(list: T[], index: number, what: string): T => {
    const value = list[index];
    if (value === undefined) throw new Error(`the heap snapshot has no ${what} at ${index}`);
    return value;
  };
  const [type, name, size] = ['type', 'name', 'self_size'].map((field) => fields.indexOf(field));
  if (type === undefined || name === undefined || size === undefined || type < 0 || name < 0 || size < 0) throw new Error(`the heap snapshot nodes lack type, name or self_size: ${fields.join(', ')}`);
  const counts = new Map<string, HeapEntry>();
  const keyOf = (index: number): string => `${at(types, at(snapshot.nodes, index + type, 'node type'), 'type name')}: ${at(snapshot.strings, at(snapshot.nodes, index + name, 'node name'), 'string').slice(0, 60).replaceAll('|', '/').replaceAll('\n', ' ')}`;
  // The first retainer chains (up to four steps) of one node of every key show what keeps it alive.
  const edgeFields = snapshot.snapshot.meta.edge_fields;
  const edgeCount = fields.indexOf('edge_count');
  const toNode = edgeFields.indexOf('to_node');
  const parents = new Map<number, number>();
  for (let index = 0, edge = 0; index < snapshot.nodes.length; index += fields.length) {
    for (let count = at(snapshot.nodes, index + edgeCount, 'edge count'); count > 0; count--, edge += edgeFields.length) {
      const child = at(snapshot.edges, edge + toNode, 'edge target');
      if (!parents.has(child)) parents.set(child, index);
    }
  }
  const retainers = new Map<string, string[]>();
  for (let index = 0; index < snapshot.nodes.length; index += fields.length) {
    const key = keyOf(index);
    if (retainers.has(key)) continue;
    const chain: string[] = [];
    for (let parent = parents.get(index), step = 0; parent !== undefined && step < 4; parent = parents.get(parent), step++) chain.push(keyOf(parent));
    retainers.set(key, [chain.join(' ← ')]);
  }
  for (let index = 0; index < snapshot.nodes.length; index += fields.length) {
    const key = keyOf(index);
    const entry = counts.get(key) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += at(snapshot.nodes, index + size, 'self size');
    counts.set(key, entry);
  }
  return { counts, retainers };
}

// Returns the Chromium Performance metrics by name. Durations are cumulative seconds.
async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

// The value of `name` in `values`; a missing value is an error.
function metric(values: Record<string, number>, name: string): number {
  const value = values[name];
  if (value === undefined) throw new Error(`no measurement ${name}; the measurements are ${Object.keys(values).join(', ')}`);
  return value;
}

// Navigates through three routes by clicking links, the way a user does, and records memory after
// forced garbage collection. A steady heap and node count shows that held data and listeners do not
// accumulate.
async function navigationMemory(browser: Browser, origin: string, cycles: number): Promise<{ rows: string[]; growth: string[]; from: number; to: number }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${origin}/board`);
  // The rows element exists once the server or the browser rendered the list; a server-rendered list holds no data
  // until it needs it (HYC-7).
  await page.waitForFunction(() => document.getElementById('rows') !== null);
  await page.waitForLoadState('networkidle');
  const visit = async (selector: string): Promise<void> => {
    const before = await page.evaluate(() => location.pathname + document.querySelector('#content h1')?.textContent);
    // element.click() inside the page; page.click adds Playwright checks that allocate memory of their own.
    await page.evaluate((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error(`the page has no ${selector}`);
      element.click();
    }, selector);
    await page.waitForFunction((before) => location.pathname + document.querySelector('#content h1')?.textContent !== before, before);
    await page.waitForLoadState('networkidle');
  };
  const sample = async (cycle: number): Promise<string> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const values = await metrics(cdp);
    return `| ${cycle} | ${(metric(values, 'JSHeapUsedSize') / 1024).toFixed(0)} | ${metric(values, 'Nodes')} | ${metric(values, 'JSEventListeners')} | ${metric(values, 'Documents')} |`;
  };
  const rows = [await sample(0)];
  let middle: Map<string, HeapEntry> | null = null;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await visit('#content a[href="/board/create"]');
    await visit('#left a[href="/board"]');
    await visit('#content td a');
    await visit('#left a[href="/board"]');
    if (cycle % 50 === 0) rows.push(await sample(cycle));
    if (cycle === cycles / 2) middle = (await heapCounts(cdp)).counts;
  }
  const end = await heapCounts(cdp);
  await context.close();
  if (middle === null) throw new Error(`no heap snapshot at cycle ${cycles / 2} of ${cycles}`);
  const before = middle;
  const retained = (key: string): string => (end.retainers.get(key) ?? []).join('; ');
  const growth = [...end.counts]
    .map(([key, value]) => ({ key, count: value.count - (before.get(key)?.count ?? 0), size: value.size - (before.get(key)?.size ?? 0) }))
    .filter((item) => item.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 12)
    .map((item) => `| ${item.key} | ${item.count} | ${item.size} | ${retained(item.key)} |`);
  return { rows, growth, from: cycles / 2, to: cycles };
}

// Creates posts through the create action, as a browser would.
async function seed(origin: string, count: number): Promise<void> {
  const page = await fetch(`${origin}/board/create`);
  const [cookie] = (page.headers.get('set-cookie') ?? '').split(';');
  const token = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  if (cookie === undefined || token === undefined) throw new Error(`${origin}/board/create gave no session cookie or no CSRF token`);
  for (let index = 1; index <= count; index++) {
    await fetch(`${origin}/board/create`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: new URLSearchParams({ _csrf: token, title: `게시글 ${index}`, author: `작성자 ${index}`, body: '본문' }),
      redirect: 'manual',
    });
  }
}

// The events of a Chromium trace with the fields that mainThreadLoad reads; a field of another type is absent.
function traceEvents(text: string): TraceEvent[] {
  const number = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
  const string = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  return jsonObjects(parseJsonObject(text, 'the trace').traceEvents, 'the trace traceEvents').map((event) => ({
    ph: string(event.ph),
    name: string(event.name),
    pid: number(event.pid),
    tid: number(event.tid),
    ts: number(event.ts),
    dur: number(event.dur),
    threadName: isJsonObject(event.args) ? string(event.args.name) : undefined,
  }));
}

// The heap snapshot of `text` with the fields that heapCounts reads.
function heapSnapshot(text: string): HeapSnapshot {
  const value = parseJsonObject(text, 'the heap snapshot');
  const meta = jsonObject(jsonObject(value.snapshot, 'the heap snapshot snapshot').meta, 'the heap snapshot meta');
  const strings = (list: unknown, where: string): string[] => jsonArray(list, where).map((item, index) => jsonString(item, `${where}[${index}]`));
  const numbers = (list: unknown, where: string): number[] => {
    const items = jsonArray(list, where);
    if (!items.every((item): item is number => typeof item === 'number')) throw new TypeError(`${where} holds a value that is no number`);
    return items;
  };
  const [nodeTypes, ...otherTypes] = jsonArray(meta.node_types, 'the heap snapshot node_types');
  return {
    snapshot: { meta: { node_fields: strings(meta.node_fields, 'node_fields'), node_types: [strings(nodeTypes, 'node_types[0]'), ...otherTypes], edge_fields: strings(meta.edge_fields, 'edge_fields') } },
    nodes: numbers(value.nodes, 'the heap snapshot nodes'),
    edges: numbers(value.edges, 'the heap snapshot edges'),
    strings: strings(value.strings, 'the heap snapshot strings'),
  };
}
