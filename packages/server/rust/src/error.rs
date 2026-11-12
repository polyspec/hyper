//! The errors of hyper (HY-132): a kind that never changes, an HTTP status or none, and a category. An error of a
//! library that hyper uses keeps the kind, the status and the category of that library (HY-132.3).

use std::fmt;

use bindgen_core::{Category, Kinds};

/// A failure of hyper or of a library that it passes on (HY-132.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// A redirect location that is not an application path (HY-46.3).
    NotApplicationPath,
    /// A redirect stop of a result that is not a redirect (HY-50.3).
    NotRedirectResult,
    /// A page status other than 200, 409 and 422 (HY-58.6).
    PageStatusNotAllowed(i64),
    /// A page status of a reply other than 403 (HY-69.7).
    ReplyStatusNotAllowed(i64),
    /// A cookie name of a reply outside HY-52.2 (HY-52.16).
    CookieNameNotAllowed(String),
    /// A cookie value of a reply outside HY-52.2 (HY-52.16).
    CookieValueNotAllowed(String),
    /// A negative `Max-Age` of a reply cookie (HY-52.16).
    NegativeMaxAge(String),
    /// An integer outside ±(2^53 − 1) where a rule takes an integer of the data model (HY-52.14, HY-69.7).
    InvalidNumber,
    /// A `Cache-Control` with a character other than U+0020 to U+007E (HY-52.16).
    CacheControlNotAllowed,
    /// A `Cache-Control` that lets a shared cache store a page (HY-52.6, HY-52.16, HY-122.6).
    CacheControlShared(String),
    /// A `Referrer-Policy` that is not a token of its specification (HY-103.9).
    ReferrerPolicyNotAllowed(String),
    /// A token or a mask that is not 64 lowercase hexadecimal digits (HY-24.14).
    InvalidCsrfForm,
    /// A stored token of another form (HY-24.14).
    InvalidSessionToken,
    /// A stored flash value or kept value of another form (HY-104.23).
    InvalidSessionRecord,
    /// Shared data that already holds the member `context` (HY-124.8).
    SharedHoldsContext,
    /// A question that only a request with a selected media type answers (HY-116.21).
    NotSelected,
    /// A representation entry that the manifest check refuses (HY-118.5 to HY-118.7).
    InvalidApplication(&'static str),
    /// A response of a representation handler that HY-122 does not allow (HY-122.2 to HY-122.8).
    InvalidRepresentation(&'static str),
    /// A failure of `Accept` (HY-116.18), with the kind and status of http-negotiate.
    Negotiate(polyspec_http_negotiate::Error),
    /// A failure of the `Set-Cookie` writer, with the kind of http-cookies (HY-45.8, HY-52.13).
    Cookies(polyspec_http_cookies::Error),
    /// A broken invariant of the core (HY-132.6).
    Internal(&'static str),
}

impl Error {
    /// The category of the failure (HY-132.1), which selects the class of each runtime (HY-132.2).
    #[must_use]
    pub fn category(&self) -> Category {
        match self {
            Error::NotApplicationPath
            | Error::NotRedirectResult
            | Error::PageStatusNotAllowed(_)
            | Error::ReplyStatusNotAllowed(_)
            | Error::CookieNameNotAllowed(_)
            | Error::CookieValueNotAllowed(_)
            | Error::NegativeMaxAge(_)
            | Error::InvalidNumber
            | Error::CacheControlNotAllowed
            | Error::CacheControlShared(_)
            | Error::ReferrerPolicyNotAllowed(_)
            | Error::InvalidCsrfForm
            | Error::SharedHoldsContext
            | Error::InvalidApplication(_)
            | Error::InvalidRepresentation(_)
            | Error::Cookies(_) => Category::Value,
            Error::Negotiate(error) => match error {
                polyspec_http_negotiate::Error::Internal => Category::Internal,
                polyspec_http_negotiate::Error::InvalidAccept
                | polyspec_http_negotiate::Error::InvalidWeight
                | polyspec_http_negotiate::Error::InvalidCandidate => Category::Value,
            },
            Error::NotSelected => Category::Type,
            Error::InvalidSessionToken | Error::InvalidSessionRecord => Category::Store,
            Error::Internal(_) => Category::Internal,
        }
    }
}

impl Kinds for Error {
    fn kind(&self) -> &'static str {
        match self {
            Error::NotApplicationPath => "not_application_path",
            Error::NotRedirectResult => "not_redirect_result",
            Error::PageStatusNotAllowed(_) => "page_status_not_allowed",
            Error::ReplyStatusNotAllowed(_) => "reply_status_not_allowed",
            Error::CookieNameNotAllowed(_) => "cookie_name_not_allowed",
            Error::CookieValueNotAllowed(_) => "cookie_value_not_allowed",
            Error::NegativeMaxAge(_) => "negative_max_age",
            Error::InvalidNumber => "invalid_number",
            Error::CacheControlNotAllowed => "cache_control_not_allowed",
            Error::CacheControlShared(_) => "cache_control_shared",
            Error::ReferrerPolicyNotAllowed(_) => "referrer_policy_not_allowed",
            Error::InvalidCsrfForm => "invalid_csrf_form",
            Error::InvalidSessionToken => "invalid_session_token",
            Error::InvalidSessionRecord => "invalid_session_record",
            Error::SharedHoldsContext => "shared_holds_context",
            Error::NotSelected => "not_selected",
            Error::InvalidApplication(_) => "invalid_application",
            Error::InvalidRepresentation(_) => "invalid_representation",
            Error::Negotiate(error) => error.kind(),
            Error::Cookies(error) => error.kind(),
            Error::Internal(_) => "internal",
        }
    }

    fn status(&self) -> Option<u16> {
        match self {
            Error::Negotiate(error) => error.status(),
            Error::NotApplicationPath
            | Error::NotRedirectResult
            | Error::PageStatusNotAllowed(_)
            | Error::ReplyStatusNotAllowed(_)
            | Error::CookieNameNotAllowed(_)
            | Error::CookieValueNotAllowed(_)
            | Error::NegativeMaxAge(_)
            | Error::InvalidNumber
            | Error::CacheControlNotAllowed
            | Error::CacheControlShared(_)
            | Error::ReferrerPolicyNotAllowed(_)
            | Error::InvalidCsrfForm
            | Error::InvalidSessionToken
            | Error::InvalidSessionRecord
            | Error::SharedHoldsContext
            | Error::NotSelected
            | Error::InvalidApplication(_)
            | Error::InvalidRepresentation(_)
            | Error::Cookies(_)
            | Error::Internal(_) => None,
        }
    }

    fn errno(&self) -> Option<i32> {
        None
    }
}

impl fmt::Display for Error {
    /// The message that a rule states, or the fixed sentence of the kind (HY-132.4).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotApplicationPath => f.write_str("a redirect location is not an application path (HY-46)"),
            Error::NotRedirectResult => f.write_str("a redirect stop needs a redirect result (HY-50)"),
            Error::PageStatusNotAllowed(status) => write!(f, "a page status {status} is not 200, 409 or 422 (HY-58)"),
            Error::ReplyStatusNotAllowed(status) => write!(f, "page status {status} of a reply is not 403 (HY-69)"),
            Error::CookieNameNotAllowed(name) => write!(f, "cookie name {name} is not allowed (HY-52)"),
            Error::CookieValueNotAllowed(name) => {
                write!(f, "cookie value of {name} has a character that is not allowed (HY-52)")
            }
            Error::NegativeMaxAge(name) => write!(f, "cookie {name} has a negative Max-Age (HY-52)"),
            Error::InvalidNumber => f.write_str("an integer is outside ±(2^53 − 1) (HY-52)"),
            Error::CacheControlNotAllowed => f.write_str("Cache-Control has a character that is not allowed (HY-52)"),
            Error::CacheControlShared(value) => write!(
                f,
                "Cache-Control {value} lets a shared cache store the page; it needs private or no-store and neither \
                 public nor s-maxage (HY-52)"
            ),
            Error::ReferrerPolicyNotAllowed(value) => write!(
                f,
                "Referrer-Policy {value} is not a token of the Referrer-Policy specification (HY-103)"
            ),
            Error::InvalidCsrfForm => {
                f.write_str("a CSRF token or mask is not 64 lowercase hexadecimal digits (HY-24)")
            }
            Error::InvalidSessionToken => f.write_str("the session holds a token of another form (HY-24)"),
            Error::InvalidSessionRecord => {
                f.write_str("the session holds a flash value or a kept value of another form (HY-104)")
            }
            Error::SharedHoldsContext => f.write_str("the shared handler returned the key context (HY-124)"),
            Error::NotSelected => f.write_str("the request holds no selected media type (HY-116)"),
            Error::InvalidApplication(reason) => write!(f, "{reason} (HY-118)"),
            Error::InvalidRepresentation(reason) => write!(f, "{reason} (HY-122)"),
            Error::Negotiate(error) => error.fmt(f),
            Error::Cookies(error) => error.fmt(f),
            Error::Internal(what) => write!(f, "an invariant of the core does not hold: {what} (HY-132)"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Negotiate(error) => Some(error),
            Error::Cookies(error) => Some(error),
            Error::NotApplicationPath
            | Error::NotRedirectResult
            | Error::PageStatusNotAllowed(_)
            | Error::ReplyStatusNotAllowed(_)
            | Error::CookieNameNotAllowed(_)
            | Error::CookieValueNotAllowed(_)
            | Error::NegativeMaxAge(_)
            | Error::InvalidNumber
            | Error::CacheControlNotAllowed
            | Error::CacheControlShared(_)
            | Error::ReferrerPolicyNotAllowed(_)
            | Error::InvalidCsrfForm
            | Error::InvalidSessionToken
            | Error::InvalidSessionRecord
            | Error::SharedHoldsContext
            | Error::NotSelected
            | Error::InvalidApplication(_)
            | Error::InvalidRepresentation(_)
            | Error::Internal(_) => None,
        }
    }
}

impl From<polyspec_http_negotiate::Error> for Error {
    fn from(error: polyspec_http_negotiate::Error) -> Self {
        Error::Negotiate(error)
    }
}

impl From<polyspec_http_cookies::Error> for Error {
    fn from(error: polyspec_http_cookies::Error) -> Self {
        Error::Cookies(error)
    }
}
