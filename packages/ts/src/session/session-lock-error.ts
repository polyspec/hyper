// A request could not take the lock of its session, or lost it before it wrote the session (HY-43, HY-115).
export class SessionLockError extends Error {}
