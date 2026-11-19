// The error of an addon of the core that does not load, by its name `CoreBindingError` (HY-133.2).
/** @internal */
export class CoreBindingError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = 'CoreBindingError';
  }
}
