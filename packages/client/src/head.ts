// Applies the parts of the head of a source document to the page: its stylesheet links (HYC-15) and its module
// scripts (HYC-25).

// A resource of a head that failed to load (HYC-14).
export class HeadError extends Error {}

// What one part of an application put into the page.
export interface HeadPart {
  // Resolves when everything that the part waits for has loaded and rejects when one of them fails to load.
  wait(): Promise<void>;
  // Removes what the part put into the page for this application.
  remove(): void;
  // Runs after the content is shown.
  settle(): void;
}

// Starts the parts of an application in order and waits until every part has loaded; the returned function settles
// every part after the content is shown. When a part fails to start or to load, every started part removes what it
// put into the page and the promise rejects (HYC-15, HYC-25).
export async function applyHead(starts: readonly (() => HeadPart)[]): Promise<() => void> {
  const parts: HeadPart[] = [];
  try {
    for (const start of starts) parts.push(start());
    await Promise.all(parts.map((part) => part.wait()));
  } catch (error) {
    for (const part of parts) part.remove();
    throw error;
  }
  return () => {
    for (const part of parts) part.settle();
  };
}
