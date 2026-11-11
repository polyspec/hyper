/** Returns twice the number. @internal */
export function twice(n: number): number {
  return 2 * n;
}

function half(n: number): number {
  return n / 2;
}

/** @internal */
export function third(n: number): number {
  return half(n) / 1.5;
}
