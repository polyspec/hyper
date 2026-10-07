// The browser entry of the sample application that the consumer fixture builds with the bins of
// @polyspec/hyper-build (HY-96): it starts the browser package with the template index of its build.
import htmx from 'htmx.org/dist/htmx.esm.js';
import { createApplication, Hyper, type HtmxApi, type Manifest, type TemplateIndex } from '@polyspec/hyper';
import type { Template } from '@polyspec/template/render';
import manifest from '../app/app.json';
import index from '@polyspec/hyper/templates-index';

const app = createApplication(manifest as Manifest, index as TemplateIndex, async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`template ${url}: status ${response.status}`);
  return (await response.json()) as Template;
});
const hyper = new Hyper(app, htmx as unknown as HtmxApi, { basePath: '' });
htmx.registerExtension('hyper', hyper.extension());
