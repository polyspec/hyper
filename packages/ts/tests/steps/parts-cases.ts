// The comparisons of the section parts of contracts/app.json (HY-12, HY-13), shared by the Node step and the browser
// step, which render with the same browser code.
import type { CaseReader } from '../case-reader.ts';

// Replaces the first text equal to `part` by the place of its name; a text that is empty or not found fails.
function placed(text: string, part: string | undefined, place: string): string {
  const at = part === undefined || part === '' ? -1 : text.indexOf(part);
  if (part === undefined || at < 0) throw new Error(`the text rendered alone for ${place} is empty or is not in its place`);
  return `${text.slice(0, at)}{# ${place}}${text.slice(at + part.length)}`;
}

// Compares the title and the parts of a case, the document with each part replaced by its place, and the page region
// with each route region of the case replaced by its place.
export function comparesParts(
  reader: CaseReader,
  rendered: { title: string; regions: ReadonlyMap<string, string> },
  document: string,
  manifest: { regions: readonly { name: string; page?: boolean }[] },
  route: { regions?: readonly { name: string }[] },
  regions: ReadonlyMap<string, unknown>,
): void {
  reader.compare('title', rendered.title);
  reader.compare('parts', Object.fromEntries(rendered.regions));
  let frame = placed(document, rendered.title, 'title');
  for (const region of manifest.regions) frame = placed(frame, rendered.regions.get(region.name), region.name);
  reader.compare('frame', frame);
  if (!reader.has('pageFrame')) return;
  const page = manifest.regions.find((region) => region.page === true);
  let pageFrame = page === undefined ? undefined : rendered.regions.get(page.name);
  if (pageFrame === undefined) throw new Error('the page region is not rendered alone');
  for (const region of route.regions ?? []) {
    if (regions.has(region.name)) pageFrame = placed(pageFrame, rendered.regions.get(region.name), region.name);
  }
  reader.compare('pageFrame', pageFrame);
}
