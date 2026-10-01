import { parseJson } from '@polyspec/template/render';
import { renderDocument, type Application } from './response.js';

// The htmx operations that client-side rendering uses.
export interface HtmxApi {
  process(element: Element): void;
}

// Renders the document of a path in the browser and replaces the title and the body (HY-22).
export async function renderLocation(app: Application, htmx: HtmxApi, basePath: string, location: string): Promise<void> {
  const url = new URL(location, window.location.origin);
  const path = url.pathname;
  if (app.router.match(path) === null) {
    mountText('Not Found');
    return;
  }
  const response = await fetch(basePath + url.pathname + url.search, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
    mountText(text);
    return;
  }
  mountDocument(renderDocument(app, parseJson(text), path), htmx);
}

// Replaces the title and the body with those of a rendered document and lets htmx process the body.
export function mountDocument(html: string, htmx: HtmxApi): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.title = parsed.title;
  document.body.replaceWith(document.adoptNode(parsed.body));
  htmx.process(document.body);
}

function mountText(text: string): void {
  const body = document.createElement('body');
  body.textContent = text;
  document.body.replaceWith(body);
}
