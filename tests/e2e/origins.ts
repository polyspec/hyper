// The origins of the servers that scripts/run-e2e.mjs started for this run: SSR (PHP at the root) and CSR (the edge
// with the static shell, which forwards /api).
function origin(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required; run the browser tests with make e2e`);
  return value;
}

export const ssr = origin('HYPER_E2E_SSR');
export const csr = origin('HYPER_E2E_CSR');
