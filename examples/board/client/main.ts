// The one browser script of the board example. Without `<meta name="hyper-api">` the page was
// rendered by the server (SSR); with it the page is a static shell that renders in the browser (CSR).
import htmx from 'htmx.org/dist/htmx.esm.js';
import { createApplication, hyperExtension, renderLocation, type Manifest } from '@polyspec/hyper';
import type { Template } from '@polyspec/template/render';
import manifest from '../app/app.json';
import templates from '../build/templates.ast.json';

const app = createApplication(manifest as Manifest, templates as unknown as Record<string, Template>);
const basePath = document.querySelector('meta[name="hyper-api"]')?.getAttribute('content') ?? null;
const mode = basePath === null ? 'ssr' : 'csr';

// The comparison page embeds both modes in frames and compares the bodies that they report after
// htmx has processed a new body and after every swap.
function report(): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'hyper-body', mode, path: location.pathname + location.search, body: document.body.innerHTML }, '*');
  }
}

const render = (path: string): void => {
  void renderLocation(app, htmx, basePath ?? '', path);
};

htmx.registerExtension('hyper', hyperExtension(app, {
  basePath: basePath ?? '',
  ...(basePath === null ? {} : { restore: render }),
}));
document.addEventListener('htmx:after:settle', report);
document.addEventListener('htmx:after:process', (event) => {
  if (event.target === document.body) report();
});

if (basePath !== null) render(location.pathname + location.search);
