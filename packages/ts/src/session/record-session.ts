// The session cookie that the PHP, Node and Python servers share (HY-45): its name and the Set-Cookie value of a new
// session, which the core gives. The record of a session is kept by the session-store library (HY-104.25).
import { rules } from '../app/core-rules.js';

/** @internal */
export class RecordSession {
  // Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
  static cookieName(secure: boolean): string {
    return rules().sessionCookieName(secure);
  }

  // Returns the Set-Cookie value of a new session (HY-45.8).
  static cookieHeader(id: string, secure: boolean): string {
    return rules().sessionCookieHeader(id, secure);
  }
}
