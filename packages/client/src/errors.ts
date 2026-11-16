// The error classes of hyper in the browser code, which runs without a binding (HY-132.7). Each class extends the base
// class of Node of its category (HY-132.2) and gives the kind of the failure, which never changes, and its HTTP status,
// null when the kind has none (HY-132.3).

export class HyperValueError extends RangeError {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperValueError';
    this.kind = kind;
    this.status = status;
  }
}

export class HyperTypeError extends TypeError {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperTypeError';
    this.kind = kind;
    this.status = status;
  }
}

export class HyperIoError extends Error {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperIoError';
    this.kind = kind;
    this.status = status;
  }
}

export class HyperStoreError extends Error {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperStoreError';
    this.kind = kind;
    this.status = status;
  }
}

export class HyperBusyError extends Error {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperBusyError';
    this.kind = kind;
    this.status = status;
  }
}

export class HyperInternalError extends Error {
  readonly kind: string;
  readonly status: number | null;
  constructor(kind: string, message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HyperInternalError';
    this.kind = kind;
    this.status = status;
  }
}

// The failure of a check at open (HY-106.21).
export function invalidApplication(message: string): HyperValueError {
  return new HyperValueError('invalid_application', message);
}
