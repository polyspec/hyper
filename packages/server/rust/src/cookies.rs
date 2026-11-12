//! The cookies of hyper (HY-45, HY-38.10): their names, which the application does not choose, and the session cookie
//! that every server writes.

use polyspec_http_cookie::{set_cookie, Attributes, SameSite};

use crate::Error;

/// The prefix of the cookies of hyper, which a reply may not use (HY-52.2).
pub const RESERVED_PREFIX: &str = "hy-";

/// The name of the session cookie (HY-45.1): `__Host-hy-session` on HTTPS, so that only its own host can set it
/// (HY-45.2), and `hy-session` otherwise.
#[must_use]
pub fn session_name(https: bool) -> &'static str {
    if https {
        "__Host-hy-session"
    } else {
        "hy-session"
    }
}

/// The name of the cookie of the `cookie` kept values (HY-38.10, HYC-13.6): `__Host-hy-keep` on HTTPS and `hy-keep`
/// otherwise; on HTTPS the host-only cookie alone counts.
#[must_use]
pub fn keep_name(https: bool) -> &'static str {
    if https {
        "__Host-hy-keep"
    } else {
        "hy-keep"
    }
}

/// The value of a cookie of hyper among the cookies of a request (HY-129.13), which give the first cookie of a name.
#[must_use]
pub fn find<'a>(cookies: &'a [(String, String)], name: &str) -> Option<&'a str> {
    cookies
        .iter()
        .find(|(cookie, _)| cookie == name)
        .map(|(_, value)| value.as_str())
}

/// The `Set-Cookie` field value of the session cookie (HY-45.3, HY-45.8): the path `/`, no `Domain`, `HttpOnly`,
/// `SameSite=Lax`, `Secure` on HTTPS and no `Max-Age`.
///
/// # Errors
/// The error of http-cookie, which an identifier of the session-store library does not give.
pub fn session_cookie(identifier: &str, https: bool) -> Result<Vec<u8>, Error> {
    let attributes = Attributes {
        path: "/".to_owned(),
        max_age: None,
        secure: https,
        http_only: true,
        same_site: Some(SameSite::Lax),
    };
    Ok(set_cookie(session_name(https), identifier, &attributes)?)
}
