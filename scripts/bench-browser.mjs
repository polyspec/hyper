// Measures the board example in Chromium: the first screen in SSR and CSR, a region navigation, the
// re-render of hy-set as the number of rows grows with its script, style and layout load, the template
// engine alone, memory over repeated navigation, template loading and the transferred bytes. It starts its own servers on the given ports with its own database.
//
// Usage: node scripts/bench-browser.mjs --ssr 8070 --edge 8071 --api 8072 --runs 15

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const { values } = parseArgs({ options: { ssr: { type: 'string' }, edge: { type: 'string' }, api: { type: 'string' }, runs: { type: 'string' } } });
for (const name of ['ssr', 'edge', 'api', 'runs']) if (!values[name]) throw new Error(`--${name} is required`);
const runs = Number(values.runs);
const TRACE_CATEGORIES = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink.user_timing'];
const PHASES = ['total', 'hyper', 'template', 'parse', 'morph', 'settle', 'process', 'events'];

// Runs hy-set changes in the page with timers around the template engine, htmx.swap and htmx.process,
// and around the htmx swap events, and returns the summed milliseconds of each phase:
// hyper is the change outside rendering and swapping (data copy, hold, store), parse is from the swap
// call to htmx:before:swap, morph is to htmx:before:settle, settle is to htmx:after:settle, process is
// htmx.process of the new content, and events is the rest of the swap.
async function attributeChange({ runs, path, values }) {
  const { hyper, htmx } = window;
  const engine = hyper.app.engine;
  const sum = { total: 0, hyper: 0, template: 0, parse: 0, morph: 0, settle: 0, process: 0, events: 0 };
  const at = {};
  const listeners = ['htmx:before:swap', 'htmx:before:settle', 'htmx:after:settle'].map((name) => {
    const listener = () => { at[name] ??= performance.now(); };
    document.addEventListener(name, listener, true);
    return [name, listener];
  });
  const render = engine.render;
  engine.render = function (...args) {
    const start = performance.now();
    try { return render.apply(this, args); } finally { sum.template += performance.now() - start; }
  };
  const swap = htmx.swap;
  htmx.swap = async function (...args) {
    at.swap = performance.now();
    try { return await swap.apply(this, args); } finally { at.swapped = performance.now(); }
  };
  const process = htmx.process;
  let depth = 0;
  let processStart = 0;
  htmx.process = function (...args) {
    if (depth++ === 0) processStart = performance.now();
    try { return process.apply(this, args); } finally { if (--depth === 0) sum.process += performance.now() - processStart; }
  };
  try {
    for (let run = 0; run < runs; run++) {
      for (const key of Object.keys(at)) delete at[key];
      const processBefore = sum.process;
      const templateBefore = sum.template;
      const start = performance.now();
      await hyper.set('rows', path, values[run % 2]);
      const total = performance.now() - start;
      const swapTime = at.swapped - at.swap;
      sum.total += total;
      sum.hyper += total - swapTime - (sum.template - templateBefore);
      sum.parse += at['htmx:before:swap'] - at.swap;
      sum.morph += at['htmx:before:settle'] - at['htmx:before:swap'];
      sum.settle += at['htmx:after:settle'] - at['htmx:before:settle'];
      sum.events += at.swapped - at['htmx:after:settle'] - (sum.process - processBefore);
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    }
  } finally {
    engine.render = render;
    delete htmx.swap;
    delete htmx.process;
    for (const [name, listener] of listeners) document.removeEventListener(name, listener, true);
  }
  return sum;
}

const KINDS = [
  ['style', /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet)$/],
  ['layout', /^(Layout|UpdateLayout)$/],
  ['paint', /^(PrePaint|Paint|PaintImage|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit)$/],
  ['gc', /GC|Scavenge|MarkCompact/],
  ['script', /^(FunctionCall|EvaluateScript|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|V8\.|v8\.)/],
];
const ssr = `http://127.0.0.1:${values.ssr}`;
const csr = `http://127.0.0.1:${values.edge}`;
const database = resolve('examples/board/var/bench-browser.db');
rmSync(database, { force: true });
const demo = spawn(process.execPath, ['scripts/serve-demo.mjs', '--db', database, '--ssr', values.ssr, '--edge', values.edge, '--api', values.api], { stdio: 'ignore' });

const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
const p95 = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length * 0.95)];
const row = (label, items, unit = 'ms') => `| ${label} | ${median(items).toFixed(2)} | ${p95(items).toFixed(2)} | ${unit} |`;

// Records when the first #content h1 with a given text appears, measured from navigation start.
const observer = () => {
  window.benchMarks = {};
  new MutationObserver(() => {
    const heading = document.querySelector('#content h1')?.textContent;
    if (heading && window.benchMarks[heading] === undefined) window.benchMarks[heading] = performance.now();
  }).observe(document, { childList: true, subtree: true, characterData: true });
};

let browser;
try {
  await waitFor(`${csr}/compare`);
  await seed(ssr, 30);
  browser = await chromium.launch();
  const lines = ['| Measurement | median | p95 | unit |', '|---|---:|---:|---|'];

  for (const [label, origin] of [['SSR', ssr], ['CSR', csr]]) {
    const first = [];
    const navigation = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(observer);
      await page.goto(`${origin}/board`);
      await page.waitForFunction(() => window.benchMarks['게시판'] !== undefined && window.hyper?.data('rows') !== undefined);
      first.push(await page.evaluate(() => window.benchMarks['게시판']));
      await page.waitForLoadState('networkidle');
      const start = await page.evaluate(() => {
        const at = performance.now();
        document.querySelector('a[href="/board/create"]').click();
        return at;
      });
      await page.waitForFunction(() => window.benchMarks['글쓰기'] !== undefined);
      navigation.push((await page.evaluate(() => window.benchMarks['글쓰기'])) - start);
      await context.close();
    }
    lines.push(row(`${label}: first screen of /board (navigation start to list heading)`, first));
    lines.push(row(`${label}: region navigation to /board/create (click to heading)`, navigation));
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${ssr}/board`);
  await page.waitForFunction(() => window.hyper?.data('rows') !== undefined);
  await page.waitForLoadState('networkidle');
  const load = [];
  const attribution = [];
  const longTasks = [];
  for (const count of [10, 100, 1000]) {
    await page.evaluate(async (count) => {
      window.benchPosts = Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `게시글 ${index} <제목>`, author: `작성자 ${index}`, created_at: 1790000000 + index }));
      await window.hyper.render('rows', { posts: window.benchPosts, sort: '', compact: false, highlight: null });
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    }, count);
    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    // Each change runs in its own task and is followed by a rendered frame, as a click would be.
    const set = await page.evaluate(async (runs) => {
      const times = [];
      for (let run = 0; run < runs; run++) {
        const at = performance.now();
        await window.hyper.set('rows', 'sort', run % 2 === 0 ? 'title' : '');
        times.push(performance.now() - at);
        await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
      }
      return times;
    }, runs);
    const trace = mainThreadLoad(JSON.parse((await browser.stopTracing()).toString()).traceEvents);
    await cdp.send('HeapProfiler.collectGarbage');
    const nodes = (await metrics(cdp)).Nodes;
    const engine = await page.evaluate((runs) => {
      const assign = { title: '게시판', posts: window.benchPosts, sort: 'title', compact: false, highlight: null };
      const times = [];
      for (let run = 0; run < runs; run++) {
        const at = performance.now();
        window.hyper.app.engine.render('board/rows.tpl', assign, { env: { timezone: '+09:00' } });
        times.push(performance.now() - at);
      }
      return times;
    }, runs);
    for (const [label, path, values] of [['sort (reorders every row)', 'sort', ['title', '']], ['compact (keeps the row order)', 'compact', [true, false]]]) {
      const phases = await page.evaluate(attributeChange, { runs, path, values });
      attribution.push(`| ${count} | ${label} | ${PHASES.map((name) => (phases[name] / runs).toFixed(2)).join(' | ')} |`);
    }
    longTasks.push(...trace.longTasks.map((task) => `| ${count} | ${task.duration.toFixed(1)} | ${task.parts.map(([name, ms]) => `${name} ${ms.toFixed(1)}`).join(', ')} |`));
    lines.push(row(`hy-set re-render of the rows region, ${count} rows (data change to DOM)`, set));
    lines.push(row(`template engine alone, board/rows.tpl, ${count} rows`, engine));
    const per = (name) => (trace[name] / runs).toFixed(2);
    load.push(`| ${count} | ${per('total')} | ${per('script')} | ${per('style')} | ${per('layout')} | ${per('paint')} | ${per('gc')} | ${per('other')} | ${trace.longest.toFixed(1)} | ${trace.long} | ${nodes} |`);
  }
  await context.close();
  await context.close();

  const memory = await navigationMemory(browser, ssr, 200);
  const csrContext = await browser.newContext();
  const csrPage = await csrContext.newPage();
  await csrPage.goto(`${csr}/board`);
  await csrPage.waitForLoadState('networkidle');
  const templates = await csrPage.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/assets/templates/'))
    .map((entry) => ({ duration: entry.duration, bytes: entry.encodedBodySize })));
  lines.push(`| CSR: template files loaded for /board | ${templates.length} | | files |`);
  lines.push(`| CSR: template loading, slowest file (first visit, local server) | ${Math.max(...templates.map((item) => item.duration)).toFixed(2)} | | ms |`);
  await csrContext.close();

  const sizes = [];
  for (const [label, headers] of [['/board document HTML', {}], ['/board region JSON', { Accept: 'application/json', 'HX-Request': 'true', 'HX-Current-URL': `${ssr}/` }]]) {
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
  console.log(`\n${runs} runs per measurement, Chromium ${browser.version()}, Node ${process.version}`);
} finally {
  await browser?.close();
  demo.kill();
  rmSync(database, { force: true });
}

// Sums the self time of every event on the renderer main thread by kind, so that a style recalculation
// forced inside a script counts as style and not as script. Returns milliseconds.
function mainThreadLoad(events) {
  const names = events.filter((event) => event.ph === 'M' && event.name === 'thread_name' && event.args.name === 'CrRendererMain');
  const busiest = names
    .map((thread) => ({ thread, count: events.filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.name === 'RunTask').length }))
    .sort((a, b) => b.count - a.count)[0].thread;
  const complete = events
    .filter((event) => event.pid === busiest.pid && event.tid === busiest.tid && event.ph === 'X' && typeof event.dur === 'number')
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const load = { total: 0, script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0, longest: 0, long: 0, longTasks: [] };
  const long = [];
  const stack = [];
  for (const event of complete) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
    if (stack.length) stack.at(-1).children += event.dur;
    else if (event.name === 'RunTask') {
      load.total += event.dur / 1000;
      load.longest = Math.max(load.longest, event.dur / 1000);
      if (event.dur > 50000) {
        load.long++;
        long.push(event);
      }
    }
    event.children = 0;
    stack.push(event);
  }
  for (const event of complete) {
    const kind = KINDS.find(([, pattern]) => pattern.test(event.name))?.[0] ?? 'other';
    load[kind] += (event.dur - event.children) / 1000;
  }
  for (const task of long) {
    const parts = new Map();
    for (const event of complete) {
      if (event.ts < task.ts || event.ts >= task.ts + task.dur) continue;
      parts.set(event.name, (parts.get(event.name) ?? 0) + (event.dur - event.children) / 1000);
    }
    load.longTasks.push({ duration: task.dur / 1000, parts: [...parts].sort((a, b) => b[1] - a[1]).slice(0, 6) });
  }
  return load;
}

// Takes a heap snapshot after garbage collection and returns the count and self size of the nodes
// grouped by type and constructor name.
async function heapCounts(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const collect = ({ chunk }) => chunks.push(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', collect);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', collect);
  const snapshot = JSON.parse(chunks.join(''));
  const fields = snapshot.snapshot.meta.node_fields;
  const types = snapshot.snapshot.meta.node_types[0];
  const [type, name, size] = ['type', 'name', 'self_size'].map((field) => fields.indexOf(field));
  const counts = new Map();
  const keyOf = (index) => `${types[snapshot.nodes[index + type]]}: ${snapshot.strings[snapshot.nodes[index + name]].slice(0, 60).replaceAll('|', '/').replaceAll('\n', ' ')}`;
  // The first retainer chains (up to four steps) of one node of every key show what keeps it alive.
  const edgeFields = snapshot.snapshot.meta.edge_fields;
  const edgeCount = fields.indexOf('edge_count');
  const toNode = edgeFields.indexOf('to_node');
  const parents = new Map();
  for (let index = 0, edge = 0; index < snapshot.nodes.length; index += fields.length) {
    for (let count = snapshot.nodes[index + edgeCount]; count > 0; count--, edge += edgeFields.length) {
      const child = snapshot.edges[edge + toNode];
      if (!parents.has(child)) parents.set(child, index);
    }
  }
  const retainers = new Map();
  for (let index = 0; index < snapshot.nodes.length; index += fields.length) {
    const key = keyOf(index);
    if (retainers.has(key)) continue;
    const chain = [];
    for (let parent = parents.get(index), step = 0; parent !== undefined && step < 4; parent = parents.get(parent), step++) chain.push(keyOf(parent));
    retainers.set(key, [chain.join(' ← ')]);
  }
  counts.retainers = retainers;
  for (let index = 0; index < snapshot.nodes.length; index += fields.length) {
    const key = keyOf(index);
    const entry = counts.get(key) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += snapshot.nodes[index + size];
    counts.set(key, entry);
  }
  return counts;
}

// Returns the Chromium Performance metrics by name. Durations are cumulative seconds.
async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

// Navigates through three routes by clicking links, the way a user does, and records memory after
// forced garbage collection. A steady heap and node count shows that held data and listeners do not
// accumulate.
async function navigationMemory(browser, origin, cycles) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${origin}/board`);
  await page.waitForFunction(() => window.hyper?.data('rows') !== undefined);
  await page.waitForLoadState('networkidle');
  const visit = async (selector) => {
    const before = await page.evaluate(() => location.pathname + document.querySelector('#content h1')?.textContent);
    // element.click() inside the page; page.click adds Playwright checks that allocate memory of their own.
    await page.evaluate((selector) => document.querySelector(selector).click(), selector);
    await page.waitForFunction((before) => location.pathname + document.querySelector('#content h1')?.textContent !== before, before);
    await page.waitForLoadState('networkidle');
  };
  const sample = async (cycle) => {
    await cdp.send('HeapProfiler.collectGarbage');
    const values = await metrics(cdp);
    return `| ${cycle} | ${(values.JSHeapUsedSize / 1024).toFixed(0)} | ${values.Nodes} | ${values.JSEventListeners} | ${values.Documents} |`;
  };
  const rows = [await sample(0)];
  let middle = null;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await visit('#content a[href="/board/create"]');
    await visit('#left a[href="/board"]');
    await visit('#content td a');
    await visit('#left a[href="/board"]');
    if (cycle % 50 === 0) rows.push(await sample(cycle));
    if (cycle === cycles / 2) middle = await heapCounts(cdp);
  }
  const end = await heapCounts(cdp);
  await context.close();
  const retained = (key) => (end.retainers.get(key) ?? []).join('; ');
  const growth = [...end]
    .map(([key, value]) => ({ key, count: value.count - (middle.get(key)?.count ?? 0), size: value.size - (middle.get(key)?.size ?? 0) }))
    .filter((item) => item.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 12)
    .map((item) => `| ${item.key} | ${item.count} | ${item.size} | ${retained(item.key)} |`);
  return { rows, growth, from: cycles / 2, to: cycles };
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error(`${url} did not start`);
}

// Creates posts through the create action, as a browser would.
async function seed(origin, count) {
  const page = await fetch(`${origin}/board/create`);
  const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0];
  const token = /name="_csrf" value="([^"]+)"/.exec(await page.text())[1];
  for (let index = 1; index <= count; index++) {
    await fetch(`${origin}/board/create`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: new URLSearchParams({ _csrf: token, title: `게시글 ${index}`, author: `작성자 ${index}`, body: '본문' }),
      redirect: 'manual',
    });
  }
}
