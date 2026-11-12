//! The values that a reply gives the response of its request (HY-52, HY-69, HY-103): the cookies that it writes, its
//! `Cache-Control`, its page status and its `Referrer-Policy`.

use polyspec_http_cookies::{set_cookie, Attributes, SameSite};

use crate::Error;

/// The tokens of the Referrer-Policy specification (HY-103.2).
pub const REFERRER_POLICIES: [&str; 8] = [
    "no-referrer",
    "no-referrer-when-downgrade",
    "origin",
    "origin-when-cross-origin",
    "same-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
];

/// The largest integer of the data model, 2^53 − 1 (VAL-2; HY-52.18, HY-69.9).
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Checks that an integer is one of the data model (HY-52.18, HY-69.9).
fn in_range(value: i64) -> Result<i64, Error> {
    if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
        Ok(value)
    } else {
        Err(Error::IntegerRange)
    }
}

/// A cookie that a reply adds: its name, its value and its `Max-Age` (HY-52.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyCookie {
    pub name: String,
    pub value: String,
    pub max_age: Option<u64>,
}

/// Whether a reply may name a cookie so (HY-52.2): `[a-z][a-z0-9_-]*` that does not start with `hy-`, because the
/// prefix is the cookies of hyper (HY-45.1, HY-38.10).
fn is_reply_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    match bytes.split_first() {
        Some((first, rest)) => {
            first.is_ascii_lowercase()
                && rest.iter().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'_' | b'-')
                })
                && !name.starts_with("hy-")
        }
        None => false,
    }
}

/// Whether a value holds only `A-Z a-z 0-9 . _ ~ -` and at least one of them (HY-52.2).
fn is_reply_value(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'))
}

/// Checks a cookie of a reply in the order of HY-52.16: the name, the value, then the `Max-Age`.
///
/// # Errors
/// `cookie_name_not_allowed`, `cookie_value_not_allowed`, `integer_range` for an integer outside ±(2^53 − 1) and
/// `negative_max_age` (HY-52.18); the binding refuses a value that is no integer.
pub fn cookie(name: &str, value: &str, max_age: Option<i64>) -> Result<ReplyCookie, Error> {
    if !is_reply_name(name) {
        return Err(Error::CookieNameNotAllowed(name.to_owned()));
    }
    if !is_reply_value(value) {
        return Err(Error::CookieValueNotAllowed(name.to_owned()));
    }
    let max_age = match max_age {
        None => None,
        Some(age) => match u64::try_from(in_range(age)?) {
            Ok(age) => Some(age),
            Err(_) => return Err(Error::NegativeMaxAge(name.to_owned())),
        },
    };
    Ok(ReplyCookie {
        name: name.to_owned(),
        value: value.to_owned(),
        max_age,
    })
}

/// The cookie that removes a cookie of the reply: its name, the empty value and `Max-Age=0` (HY-52.2). The name is
/// checked as the name of an added cookie.
///
/// # Errors
/// `cookie_name_not_allowed`.
pub fn removed_cookie(name: &str) -> Result<ReplyCookie, Error> {
    if !is_reply_name(name) {
        return Err(Error::CookieNameNotAllowed(name.to_owned()));
    }
    Ok(ReplyCookie {
        name: name.to_owned(),
        value: String::new(),
        max_age: Some(0),
    })
}

/// The `Set-Cookie` field value of a reply cookie (HY-52.13): written by `set_cookie` of http-cookies with the path `/`,
/// `secure` on HTTPS (HY-45.6), `http_only` and `same_site` `Lax`.
///
/// # Errors
/// The error of http-cookies, which a checked cookie does not give.
pub fn set_cookie_field(cookie: &ReplyCookie, https: bool) -> Result<Vec<u8>, Error> {
    let attributes = Attributes {
        path: "/".to_owned(),
        max_age: cookie.max_age,
        secure: https,
        http_only: true,
        same_site: Some(SameSite::Lax),
    };
    Ok(set_cookie(&cookie.name, &cookie.value, &attributes)?)
}

/// Checks a `Cache-Control` value that a reply sets for a page (HY-52.6, HY-52.16) and that a representation handler
/// sets for a request with `Authorization` (HY-122.6): characters U+0020 to U+007E only, and a directive `private` or
/// `no-store` and neither `public` nor `s-maxage`, the names compared without case (RFC 9111, section 5.2).
///
/// # Errors
/// `cache_control_not_allowed` for another character and `cache_control_shared` for a value that a shared cache may
/// store.
pub fn cache_control(value: &str) -> Result<&str, Error> {
    if value.is_empty() || !value.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
        return Err(Error::CacheControlNotAllowed);
    }
    if !keeps_out_of_shared_caches(value) {
        return Err(Error::CacheControlShared(value.to_owned()));
    }
    Ok(value)
}

/// Whether a `Cache-Control` value has `private` or `no-store` and neither `public` nor `s-maxage` (HY-52.6).
#[must_use]
pub fn keeps_out_of_shared_caches(value: &str) -> bool {
    let names: Vec<String> = value
        .split(',')
        .map(|part| {
            let name = match part.find('=') {
                Some(end) => &part[..end],
                None => part,
            };
            name.trim().to_ascii_lowercase()
        })
        .collect();
    names
        .iter()
        .any(|name| name == "private" || name == "no-store")
        && !names
            .iter()
            .any(|name| name == "public" || name == "s-maxage")
}

/// Checks the page status that a reply gives (HY-69.9): 403; the binding refuses a value that is no integer.
///
/// # Errors
/// `integer_range` outside ±(2^53 − 1) and `reply_status_not_allowed` for another integer (HY-69.9).
pub fn status(status: i64) -> Result<u16, Error> {
    if in_range(status)? == 403 {
        Ok(403)
    } else {
        Err(Error::ReplyStatusNotAllowed(status))
    }
}

/// Checks a `Referrer-Policy` that a reply sets (HY-103.2, HY-103.9): one of the tokens, compared exactly.
///
/// # Errors
/// `referrer_policy_not_allowed`.
pub fn referrer_policy(value: &str) -> Result<&str, Error> {
    if REFERRER_POLICIES.contains(&value) {
        Ok(value)
    } else {
        Err(Error::ReferrerPolicyNotAllowed(value.to_owned()))
    }
}
