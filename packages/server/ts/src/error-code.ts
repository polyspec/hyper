// The errno code of an error of Node.js, such as ENOENT, or undefined for an error without one.
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
