// A JSON text that does not decode as PHP json_decode reads it (HY-54).

/** @internal */
export class JsonDecodeError extends Error {}
