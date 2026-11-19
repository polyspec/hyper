/** The rules of the core, as the native addon provides them. */
export interface CoreRules {
  csrfMask(token: string, mask: string): string;
}

declare function sharedRules<T>(load: () => T): () => T;

/** Returns the one CoreRules of the server, from the native addon of the package. */
export const rules: () => CoreRules = sharedRules(() => ({ csrfMask: (token: string, mask: string): string => token + mask }));
