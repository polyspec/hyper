// The one browser script of the board example. Without `<meta name="hyper-api">` the page was
// rendered by the server (SSR); with it the page is a static shell that renders in the browser (CSR).
import htmx from 'htmx.org/dist/htmx.esm.js';
import { createApplication, Hyper, type HtmxApi, type Manifest, type TemplateIndex } from '@polyspec/hyper';
import type { Template } from '@polyspec/template/render';
import manifest from '../app/app.json';
import index from '../build/templates.index.json';

const app = createApplication(manifest as Manifest, index as TemplateIndex, async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`template ${url}: status ${response.status}`);
  return (await response.json()) as Template;
});
const basePath = document.querySelector('meta[name="hyper-api"]')?.getAttribute('content') ?? null;
const hyper = new Hyper(app, htmx as unknown as HtmxApi, { basePath: basePath ?? '' });
(window as unknown as { hyper: Hyper }).hyper = hyper;

htmx.registerExtension('hyper', hyper.extension());

// HY-36: a click on an element with hy-set changes region data and renders the region without a request.
document.addEventListener('click', (event) => {
  const element = (event.target as Element | null)?.closest?.('[hy-set]');
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  // A failure leaves the data unchanged and marks the region with hy-error (HY-47).
  hyper.setFrom(element).then(report, (error: unknown) => console.error(error));
}, true);

// The comparison page embeds both modes in frames and compares them after htmx has processed a new
// body and after every swap. A frame sends only the SHA-256 of its body, because the body holds the
// CSRF token, and only to the origin of the page that embeds it. Every response masks the token anew
// (HY-24), so the digest reads the body with each masked token, 128 hexadecimal digits, as <csrf>.
const mode = basePath === null ? 'ssr' : 'csr';
const parentOrigin = window.parent !== window && document.referrer !== '' ? new URL(document.referrer).origin : null;
async function report(): Promise<void> {
  if (parentOrigin === null) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document.body.innerHTML.replace(/\b[0-9a-f]{128}\b/g, '<csrf>')));
  const body = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  window.parent.postMessage({ type: 'hyper-body', mode, path: location.pathname + location.search, body }, parentOrigin);
}
document.addEventListener('htmx:after:settle', () => void report());
document.addEventListener('htmx:after:process', (event) => {
  if (event.target === document.body) void report();
});

if (basePath === null) {
  // HY-32: the server embedded the document data, so the first page can change without a request.
  const embedded = document.getElementById('hy-data')?.textContent;
  if (embedded) void hyper.holdEmbedded(embedded, location.pathname);
} else {
  void hyper.renderLocation(location.pathname + location.search);
}
