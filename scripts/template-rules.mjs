// The template checks of an application (HY-48): HC-6, only the layout template of an application carries hx-*
// attributes; HY-3, the layout places {# title}, {# data} and every manifest region exactly once; HY-3 and HY-30,
// every region is placed once, directly inside an element whose id is the region name, without block arguments:
// a manifest region in the layout, and a route region in the route template or in a template that the route
// template includes or places by path (HY-75). `make templates-check` and the server build use it, so an
// server program never serves templates that break these rules.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Returns the problems of the templates below `templatesDir` for the manifest, and the number of templates. The
// parser and the path resolution of the template package are passed in, because the server build loads them from
// the template repository that it compiles with.
export function templateProblems({ manifest, templatesDir, parse, resolvePath }) {
  const { layout } = manifest;
  const problems = [];
  const files = listFiles(templatesDir).filter((file) => file.endsWith('.tpl'));
  for (const file of files) {
    const name = relative(templatesDir, file).split(sep).join('/');
    if (name === layout) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/\shx-[a-z]/i.test(line)) problems.push(`${name}:${index + 1}: hx- attribute outside the layout (HC-6)`);
    });
  }
  // Returns the block placements of a template body, each with the text that precedes it.
  const placements = (body) => {
    const found = [];
    const visit = (nodes) => {
      nodes.forEach((node, index) => {
        if (node.type === 'Block' && typeof node.id === 'string' && node.path === null) {
          const previous = nodes[index - 1];
          found.push({ node, before: previous?.type === 'Text' ? previous.value : '' });
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && typeof item.type === 'string')) visit(value);
        }
      });
    };
    visit(body);
    return found;
  };
  // Returns the block placements of a template and of every template that it includes or places by path.
  const graphPlacements = (entry) => {
    const found = [];
    const seen = new Set();
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const body = parse(readFileSync(join(templatesDir, name)), name).body;
      found.push(...placements(body));
      const references = (nodes) => {
        for (const node of nodes) {
          if ((node.type === 'Include' || node.type === 'Block') && typeof node.path === 'string') visit(resolvePath(name, node.path));
          for (const value of Object.values(node)) {
            if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && typeof item.type === 'string')) references(value);
          }
        }
      };
      references(body);
    };
    visit(entry);
    return found;
  };
  const checkRegions = (name, body, regions, found = placements(body)) => {
    for (const region of regions) {
      const places = found.filter((item) => item.node.id === region);
      if (places.length !== 1) {
        problems.push(`${name}: places {# ${region}} ${places.length} times, expected once (HY-3, HY-30)`);
        continue;
      }
      const { node, before } = places[0];
      if (!new RegExp(`<[a-z][a-z0-9-]*(\\s[^<>]*)?\\sid="${region}"[^<>]*>$`).test(before)) {
        problems.push(`${name}: {# ${region}} is not directly inside an element with id="${region}" (HY-3, HY-30)`);
      }
      if ((node.scope ?? []).length > 0) problems.push(`${name}: {# ${region}} has block arguments (HY-3, HY-30)`);
    }
  };
  const layoutBody = parse(readFileSync(join(templatesDir, layout)), layout).body;
  for (const id of ['title', 'data']) {
    const count = placements(layoutBody).filter((item) => item.node.id === id).length;
    if (count !== 1) problems.push(`${layout}: places {# ${id}} ${count} times, expected once (HY-3)`);
  }
  checkRegions(layout, layoutBody, manifest.regions.filter((region) => !region.page).map((region) => region.name));
  const page = manifest.regions.find((region) => region.page).name;
  checkRegions(layout, layoutBody, [page]);
  for (const route of manifest.routes) {
    if ((route.regions ?? []).length === 0) continue;
    checkRegions(route.template, [], route.regions.map((region) => region.name), graphPlacements(route.template));
  }
  return { problems, templates: files.length };
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
