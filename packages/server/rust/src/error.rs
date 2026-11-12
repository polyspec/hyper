//! The errors of hyper (HY-132): a kind that never changes, an HTTP status or none, and a category. An error of a
//! library that hyper uses keeps the kind, the status and the category of that library (HY-132.3).

use std::fmt;

use bindgen_core::{Category, Kinds};

/// A failure of hyper or of a library that it passes on (HY-132.3).
#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// A redirect location that is not an application path (HY-46.3).
    NotApplicationPath,
    /// A redirect stop of a result that is not a redirect (HY-50.3).
    NotRedirectResult,
    /// A page status other than 200, 409 and 422 (HY-58.6).
    PageStatusNotAllowed(i64),
    /// A page status of a reply other than 403 (HY-69.9).
    ReplyStatusNotAllowed(i64),
    /// A cookie name of a reply outside HY-52.2 (HY-52.16).
    CookieNameNotAllowed(String),
    /// A cookie value of a reply outside HY-52.2 (HY-52.16).
    CookieValueNotAllowed(String),
    /// A negative `Max-Age` of a reply cookie (HY-52.16).
    NegativeMaxAge(String),
    /// An integer outside ±(2^53 − 1) where a rule takes an integer of the data model (HY-52.18, HY-69.9).
    IntegerRange,
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
    InvalidApplication(std::borrow::Cow<'static, str>),
    /// A response of a representation handler that HY-122 does not allow (HY-122.2 to HY-122.8).
    InvalidRepresentation(&'static str),
    /// A value outside the data model, with the kind of the template data model (HY-44.9).
    DataModel(polyspec_template::BindError),
    /// A failure of the template language while a template renders, with its kind (HY-43, HY-38.18).
    Template(polyspec_template::TemplateError),
    /// A broken invariant of a record that php-serialize reports, such as an identity that the record does not hold
    /// (HY-132.6).
    RecordValue(polyspec_php_serialize::Error),
    /// A failure of the session-store library, with its kind (HY-104.25).
    Sessions(polyspec_sessions::Error),
    /// A failure of `Accept` (HY-116.18), with the kind and status of http-negotiation.
    Negotiate(polyspec_http_negotiation::Error),
    /// A failure of the `Set-Cookie` writer, with the kind of http-cookie (HY-45.8, HY-52.13).
    Cookies(polyspec_http_cookie::Error),
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
            | Error::IntegerRange
            | Error::CacheControlNotAllowed
            | Error::CacheControlShared(_)
            | Error::ReferrerPolicyNotAllowed(_)
            | Error::InvalidCsrfForm
            | Error::SharedHoldsContext
            | Error::InvalidApplication(_)
            | Error::InvalidRepresentation(_)
            | Error::Cookies(_) => Category::Value,
            Error::Negotiate(error) => match error {
                polyspec_http_negotiation::Error::Internal => Category::Internal,
                polyspec_http_negotiation::Error::InvalidAccept
                | polyspec_http_negotiation::Error::InvalidWeight
                | polyspec_http_negotiation::Error::InvalidCandidate => Category::Value,
            },
            Error::NotSelected => Category::Type,
            Error::DataModel(_) => Category::Value,
            Error::Template(error) => template_category(error.code),
            Error::Sessions(error) => sessions_category(error),
            Error::InvalidSessionToken | Error::InvalidSessionRecord => Category::Store,
            Error::Internal(_) | Error::RecordValue(_) => Category::Internal,
        }
    }
}

impl Error {
    /// The byte offset in a session record of a failure to decode it, as the session-store library gives it, or none for
    /// every other failure (HY-104.8).
    #[must_use]
    pub fn offset(&self) -> Option<u64> {
        match self {
            Error::Sessions(error) => error.offset(),
            _ => None,
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
            Error::IntegerRange => "integer_range",
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
            Error::DataModel(error) => error.code.as_str(),
            Error::Template(error) => error.code.as_str(),
            Error::Sessions(error) => error.kind(),
            Error::Negotiate(error) => error.kind(),
            Error::Cookies(error) => error.kind(),
            Error::Internal(_) | Error::RecordValue(_) => "internal",
        }
    }

    fn status(&self) -> Option<u16> {
        match self {
            Error::Negotiate(error) => error.status(),
            Error::Sessions(error) => error.status(),
            Error::RecordValue(_) => None,
            Error::DataModel(_) => None,
            Error::Template(_) => None,
            Error::NotApplicationPath
            | Error::NotRedirectResult
            | Error::PageStatusNotAllowed(_)
            | Error::ReplyStatusNotAllowed(_)
            | Error::CookieNameNotAllowed(_)
            | Error::CookieValueNotAllowed(_)
            | Error::NegativeMaxAge(_)
            | Error::IntegerRange
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
        match self {
            Error::Sessions(error) => error.errno(),
            _ => None,
        }
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
            Error::IntegerRange => f.write_str("an integer is outside ±(2^53 − 1) (HY-52, HY-69)"),
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
            Error::InvalidApplication(reason) => f.write_str(reason),
            Error::InvalidRepresentation(reason) => write!(f, "{reason} (HY-122)"),
            Error::DataModel(error) => error.fmt(f),
            Error::Template(error) => error.fmt(f),
            Error::Sessions(error) => error.fmt(f),
            Error::RecordValue(error) => write!(f, "an invariant of a session record does not hold: {error} (HY-132)"),
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
            Error::Sessions(error) => Some(error),
            Error::RecordValue(error) => Some(error),
            Error::DataModel(_) => None,
            Error::Template(error) => Some(error),
            Error::Cookies(error) => Some(error),
            Error::NotApplicationPath
            | Error::NotRedirectResult
            | Error::PageStatusNotAllowed(_)
            | Error::ReplyStatusNotAllowed(_)
            | Error::CookieNameNotAllowed(_)
            | Error::CookieValueNotAllowed(_)
            | Error::NegativeMaxAge(_)
            | Error::IntegerRange
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

impl From<polyspec_http_negotiation::Error> for Error {
    fn from(error: polyspec_http_negotiation::Error) -> Self {
        Error::Negotiate(error)
    }
}

impl From<polyspec_http_cookie::Error> for Error {
    fn from(error: polyspec_http_cookie::Error) -> Self {
        Error::Cookies(error)
    }
}

/// The category of a failure of the session-store library, as its interface contract gives it (E-1b).
fn sessions_category(error: &polyspec_sessions::Error) -> Category {
    use polyspec_sessions::Error as Sessions;
    match error {
        Sessions::Random { .. } | Sessions::IdentifierTaken { .. } | Sessions::Internal { .. } => {
            Category::Internal
        }
        Sessions::Record { .. }
        | Sessions::RecordNotArray { .. }
        | Sessions::RecordWrite { .. }
        | Sessions::LockTimeout { .. }
        | Sessions::LockLost { .. }
        | Sessions::Reply { .. }
        | Sessions::Redis { .. } => Category::Store,
        Sessions::InvalidDirectory { .. }
        | Sessions::InvalidLifetime
        | Sessions::InvalidLockExpire
        | Sessions::InvalidSetting { .. } => Category::Value,
        Sessions::Cancelled | Sessions::Io { .. } | Sessions::Connection { .. } => Category::Io,
    }
}

/// The category of a kind of the template language, as its interface contract states it.
fn template_category(code: polyspec_template::ErrorCode) -> Category {
    use polyspec_template::ErrorCode;
    match code {
        ErrorCode::E_LOAD_FAILED => Category::Io,
        ErrorCode::E_DATA_UNSUPPORTED_TYPE
        | ErrorCode::E_RUNTIME_TYPE
        | ErrorCode::E_RUNTIME_ARITY => Category::Type,
        ErrorCode::E_INTERNAL => Category::Internal,
        _ => Category::Value,
    }
}
