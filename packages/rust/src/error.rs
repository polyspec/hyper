//! The errors of hyper (HY-133): a kind that never changes, an HTTP status or none, and a category. An error of a
//! library that hyper uses keeps the kind, the status and the category of that library (HY-133.3).

use std::fmt;

use binding_core::{Category, Kinds};

/// A failure of hyper or of a library that it passes on (HY-133.3).
#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// A redirect location that is not an application path (HY-46.3).
    NotApplicationPath,
    /// A redirect stop of a result that is not a redirect (HY-50.3).
    NotRedirectResult,
    /// An outside redirect to a text that is no outside location (HY-132.5).
    NotOutsideLocation,
    /// A flash value or a changed topic of an outside redirect, which stores neither (HY-132.10).
    OutsideRedirectStores,
    /// A page status other than 200, 409 and 422 (HY-58.6).
    PageStatusNotAllowed(i64),
    /// A page status of a reply other than 403 (HY-69.11).
    ReplyStatusNotAllowed(i64),
    /// A cookie name of a reply outside HY-52.2 (HY-52.16).
    CookieNameNotAllowed(String),
    /// A cookie value of a reply outside HY-52.2 (HY-52.16).
    CookieValueNotAllowed(String),
    /// A negative `Max-Age` of a reply cookie (HY-52.16).
    NegativeMaxAge(String),
    /// An integer outside ±(2^53 − 1) where a rule takes an integer of the data model (HY-52.20, HY-69.11).
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
    /// A `collect` of the PHP server under a session handler that is not its files handler (HY-104.44, HY-133.14).
    InvalidSessionHandler,
    /// Shared data that already holds the member `context` (HY-124.8).
    SharedHoldsContext,
    /// A question that only a request with a selected media type answers (HY-116.21).
    NotSelected,
    /// A `Content-Type` of a request that is no media type, the empty value included (HY-59.13).
    MalformedContentType,
    /// A representation entry that the manifest check refuses (HY-118.5 to HY-118.7).
    InvalidApplication(std::borrow::Cow<'static, str>),
    /// A file that a build writes with a path that HY-125.17 does not allow, a build id of another form, or a
    /// `build.json` that does not hold one (HY-125.17 to HY-125.19).
    InvalidBuild(std::borrow::Cow<'static, str>),
    /// A response of a representation handler that HY-122 does not allow (HY-122.2 to HY-122.8).
    InvalidRepresentation(&'static str),
    /// A JSON text that json refuses (HY-54.21), with that rejection as its source.
    MalformedJson(polyspec_json::Error),
    /// A value outside the data model, with the kind of the template data model (HY-44.12).
    DataModel(polyspec_template::BindError),
    /// A failure of the template language while a template renders, with its kind (HY-43, HY-38.18).
    Template(polyspec_template::TemplateError),
    /// A broken invariant of a record that php-serialize reports, such as an identity that the record does not hold
    /// (HY-133.6).
    RecordValue(polyspec_php_serialization::Error),
    /// A failure of the session-store library, with its kind (HY-104.25).
    Sessions(polyspec_session_store::Error),
    /// A failure of `Accept` (HY-116.18), with the kind and status of http-negotiation.
    Negotiate(polyspec_http_negotiation::Error),
    /// A failure of the `Set-Cookie` writer, with the kind of http-cookie (HY-45.8, HY-52.13).
    Cookies(polyspec_http_cookie::Error),
    /// A failure of the body of a request or of one of its files, with the kind, the status and the category of
    /// http-form (F-9, F-11, F-25; H35.11).
    Form(polyspec_http_form::Error),
    /// A broken invariant of the core (HY-133.6).
    Internal(&'static str),
}

/// The code of an error (HY-133.1), which the interface contract lists as its kinds: a failure of hyper itself is one
/// variant, and a failure of a library that hyper passes on is the variant of that library with the code of the library
/// (HY-133.3). `Error::DataModel` and `Error::Template` both hold a code of the template language, so both are
/// `Template`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ErrorCode<'a> {
    /// A redirect location that is not an application path (HY-46.3).
    NotApplicationPath,
    /// A redirect stop of a result that is not a redirect (HY-50.3).
    NotRedirectResult,
    /// An outside redirect to a text that is no outside location (HY-132.5).
    NotOutsideLocation,
    /// A flash value or a changed topic of an outside redirect, which stores neither (HY-132.10).
    OutsideRedirectStores,
    /// A page status other than 200, 409 and 422 (HY-58.6).
    PageStatusNotAllowed,
    /// A page status of a reply other than 403 (HY-69.11).
    ReplyStatusNotAllowed,
    /// A cookie name of a reply outside HY-52.2 (HY-52.16).
    CookieNameNotAllowed,
    /// A cookie value of a reply outside HY-52.2 (HY-52.16).
    CookieValueNotAllowed,
    /// A negative `Max-Age` of a reply cookie (HY-52.16).
    NegativeMaxAge,
    /// An integer outside ±(2^53 − 1) (HY-52.20, HY-69.11).
    IntegerRange,
    /// A `Cache-Control` with a character that is not allowed (HY-52.16).
    CacheControlNotAllowed,
    /// A `Cache-Control` that lets a shared cache store a page (HY-52.6).
    CacheControlShared,
    /// A `Referrer-Policy` that is not a token of its specification (HY-103.9).
    ReferrerPolicyNotAllowed,
    /// A token or a mask of another form (HY-24.14).
    InvalidCsrfForm,
    /// A stored token of another form (HY-24.14).
    InvalidSessionToken,
    /// A stored flash value or kept value of another form (HY-104.23).
    InvalidSessionRecord,
    /// A `collect` of the PHP server under a session handler that is not its files handler (HY-133.14).
    InvalidSessionHandler,
    /// Shared data that already holds the member `context` (HY-124.8).
    SharedHoldsContext,
    /// A question that only a request with a selected media type answers (HY-116.21).
    NotSelected,
    /// A `Content-Type` of a request that is no media type (HY-59.13).
    MalformedContentType,
    /// A representation entry that the manifest check refuses (HY-118.5 to HY-118.7).
    InvalidApplication,
    /// A build that HY-125.17 to HY-125.19 refuse.
    InvalidBuild,
    /// A response of a representation handler that HY-122 does not allow.
    InvalidRepresentation,
    /// A JSON text that json refuses (HY-54.21).
    MalformedJson,
    /// A broken invariant of the core (HY-133.6).
    Internal,
    /// A broken invariant of a record that php-serialize reports (HY-133.6).
    RecordValue,
    /// A code of the template language, of its data model (HY-44.12) or of a render (HY-43, HY-38.18).
    Template(polyspec_template::ErrorCode),
    /// A failure of the session-store library (HY-104.25).
    Sessions(&'a polyspec_session_store::Error),
    /// A failure of http-negotiation (HY-116.18).
    Negotiate(polyspec_http_negotiation::Error),
    /// A failure of http-cookie (HY-45.8, HY-52.13).
    Cookies(polyspec_http_cookie::Error),
    /// A failure of http-form (F-9, F-11, F-25).
    Form(&'a polyspec_http_form::Error),
}

/// An error as its questions read it: a failure of hyper itself, with the kind and the category that HY-133.1 gives it,
/// or the error of a library that hyper passes on (HY-133.3).
enum Part<'a> {
    Own(&'static str, Category),
    DataModel(&'a polyspec_template::BindError),
    Template(&'a polyspec_template::TemplateError),
    RecordValue(&'a polyspec_php_serialization::Error),
    Sessions(&'a polyspec_session_store::Error),
    Negotiate(&'a polyspec_http_negotiation::Error),
    Cookies(&'a polyspec_http_cookie::Error),
    Form(&'a polyspec_http_form::Error),
}

impl Error {
    /// The kind and the category of a failure of hyper itself, or the error of the library that it passes on.
    fn part(&self) -> Part<'_> {
        match self {
            Error::NotApplicationPath => Part::Own("not_application_path", Category::Value),
            Error::NotOutsideLocation => Part::Own("not_outside_location", Category::Value),
            Error::OutsideRedirectStores => Part::Own("outside_redirect_stores", Category::Value),
            Error::NotRedirectResult => Part::Own("not_redirect_result", Category::Value),
            Error::PageStatusNotAllowed(_) => Part::Own("page_status_not_allowed", Category::Value),
            Error::ReplyStatusNotAllowed(_) => {
                Part::Own("reply_status_not_allowed", Category::Value)
            }
            Error::CookieNameNotAllowed(_) => Part::Own("cookie_name_not_allowed", Category::Value),
            Error::CookieValueNotAllowed(_) => {
                Part::Own("cookie_value_not_allowed", Category::Value)
            }
            Error::NegativeMaxAge(_) => Part::Own("negative_max_age", Category::Value),
            Error::IntegerRange => Part::Own("integer_range", Category::Value),
            Error::CacheControlNotAllowed => {
                Part::Own("cache_control_not_allowed", Category::Value)
            }
            Error::CacheControlShared(_) => Part::Own("cache_control_shared", Category::Value),
            Error::ReferrerPolicyNotAllowed(_) => {
                Part::Own("referrer_policy_not_allowed", Category::Value)
            }
            Error::InvalidCsrfForm => Part::Own("invalid_csrf_form", Category::Value),
            Error::InvalidSessionToken => Part::Own("invalid_session_token", Category::Store),
            Error::InvalidSessionRecord => Part::Own("invalid_session_record", Category::Store),
            Error::InvalidSessionHandler => Part::Own("invalid_session_handler", Category::Value),
            Error::SharedHoldsContext => Part::Own("shared_holds_context", Category::Value),
            Error::NotSelected => Part::Own("not_selected", Category::Type),
            Error::MalformedContentType => Part::Own("malformed_content_type", Category::Value),
            Error::InvalidApplication(_) => Part::Own("invalid_application", Category::Value),
            Error::InvalidBuild(_) => Part::Own("invalid_build", Category::Value),
            Error::InvalidRepresentation(_) => Part::Own("invalid_representation", Category::Value),
            Error::MalformedJson(_) => Part::Own("malformed_json", Category::Value),
            Error::Internal(_) => Part::Own("internal", Category::Internal),
            Error::DataModel(error) => Part::DataModel(error),
            Error::Template(error) => Part::Template(error),
            Error::RecordValue(error) => Part::RecordValue(error),
            Error::Sessions(error) => Part::Sessions(error),
            Error::Negotiate(error) => Part::Negotiate(error),
            Error::Cookies(error) => Part::Cookies(error),
            Error::Form(error) => Part::Form(error),
        }
    }

    /// The code of the failure (HY-133.1, HY-133.3), which the bindings read to tell its kind apart.
    #[must_use]
    pub fn code(&self) -> ErrorCode<'_> {
        match self {
            Error::NotApplicationPath => ErrorCode::NotApplicationPath,
            Error::NotOutsideLocation => ErrorCode::NotOutsideLocation,
            Error::OutsideRedirectStores => ErrorCode::OutsideRedirectStores,
            Error::NotRedirectResult => ErrorCode::NotRedirectResult,
            Error::PageStatusNotAllowed(_) => ErrorCode::PageStatusNotAllowed,
            Error::ReplyStatusNotAllowed(_) => ErrorCode::ReplyStatusNotAllowed,
            Error::CookieNameNotAllowed(_) => ErrorCode::CookieNameNotAllowed,
            Error::CookieValueNotAllowed(_) => ErrorCode::CookieValueNotAllowed,
            Error::NegativeMaxAge(_) => ErrorCode::NegativeMaxAge,
            Error::IntegerRange => ErrorCode::IntegerRange,
            Error::CacheControlNotAllowed => ErrorCode::CacheControlNotAllowed,
            Error::CacheControlShared(_) => ErrorCode::CacheControlShared,
            Error::ReferrerPolicyNotAllowed(_) => ErrorCode::ReferrerPolicyNotAllowed,
            Error::InvalidCsrfForm => ErrorCode::InvalidCsrfForm,
            Error::InvalidSessionToken => ErrorCode::InvalidSessionToken,
            Error::InvalidSessionRecord => ErrorCode::InvalidSessionRecord,
            Error::InvalidSessionHandler => ErrorCode::InvalidSessionHandler,
            Error::SharedHoldsContext => ErrorCode::SharedHoldsContext,
            Error::NotSelected => ErrorCode::NotSelected,
            Error::MalformedContentType => ErrorCode::MalformedContentType,
            Error::InvalidApplication(_) => ErrorCode::InvalidApplication,
            Error::InvalidBuild(_) => ErrorCode::InvalidBuild,
            Error::InvalidRepresentation(_) => ErrorCode::InvalidRepresentation,
            Error::MalformedJson(_) => ErrorCode::MalformedJson,
            Error::Internal(_) => ErrorCode::Internal,
            Error::RecordValue(_) => ErrorCode::RecordValue,
            Error::DataModel(error) => ErrorCode::Template(error.code),
            Error::Template(error) => ErrorCode::Template(error.code),
            Error::Sessions(error) => ErrorCode::Sessions(error),
            Error::Negotiate(error) => ErrorCode::Negotiate(*error),
            Error::Cookies(error) => ErrorCode::Cookies(*error),
            Error::Form(error) => ErrorCode::Form(error),
        }
    }

    /// The category of the failure (HY-133.1), which selects the class of each runtime (HY-133.2).
    #[must_use]
    pub fn category(&self) -> Category {
        match self.part() {
            Part::Own(_, category) => category,
            Part::Negotiate(error) => match error {
                polyspec_http_negotiation::Error::Internal => Category::Internal,
                polyspec_http_negotiation::Error::InvalidAccept
                | polyspec_http_negotiation::Error::InvalidWeight
                | polyspec_http_negotiation::Error::InvalidCandidate => Category::Value,
            },
            Part::DataModel(error) => template_category(error.code),
            Part::Cookies(error) => cookies_category(*error),
            Part::Template(error) => template_category(error.code),
            Part::Sessions(error) => sessions_category(error),
            Part::RecordValue(_) => Category::Internal,
            Part::Form(error) => form_category(error),
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

    /// The kind of the failed removal of the new file of `partial_target` of http-form (F-11), the property
    /// `removalKind` of its error class.
    ///
    /// # Errors
    ///
    /// `internal` for every other failure, whose class has no such property.
    pub fn removal_kind(&self) -> Result<&'static str, Error> {
        match self {
            Error::Form(error) => Ok(error.removal_kind()?),
            _ => Err(Error::Internal("the removal of a failure that is not partial_target")),
        }
    }

    /// The `errno` of the failed removal of the new file of `partial_target` of http-form (F-11), the property
    /// `removalErrno` of its error class, or none when the system gave none.
    ///
    /// # Errors
    ///
    /// `internal` for every other failure, whose class has no such property.
    pub fn removal_errno(&self) -> Result<Option<i64>, Error> {
        match self {
            Error::Form(error) => Ok(error.removal_errno()?),
            _ => Err(Error::Internal("the removal of a failure that is not partial_target")),
        }
    }
}

impl Kinds for Error {
    fn kind(&self) -> &'static str {
        match self.part() {
            Part::Own(kind, _) => kind,
            Part::DataModel(error) => error.code.as_str(),
            Part::Template(error) => error.code.as_str(),
            Part::Sessions(error) => error.kind(),
            Part::Negotiate(error) => error.kind(),
            Part::Cookies(error) => error.kind(),
            Part::Form(error) => error.kind(),
            Part::RecordValue(_) => "internal",
        }
    }

    fn status(&self) -> Option<u16> {
        // HY-59.12: a request whose Content-Type is no media type receives 400.
        if let Error::MalformedContentType = self {
            return Some(400);
        }
        match self.part() {
            Part::Negotiate(error) => error.status(),
            Part::Sessions(error) => error.status(),
            Part::Form(error) => error.status(),
            Part::Own(..)
            | Part::RecordValue(_)
            | Part::DataModel(_)
            | Part::Template(_)
            | Part::Cookies(_) => None,
        }
    }

    fn errno(&self) -> Option<i32> {
        match self {
            Error::Sessions(error) => error.errno(),
            Error::Form(error) => error.errno(),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    /// The message that a rule states, or the fixed sentence of the kind (HY-133.4).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotApplicationPath => f.write_str("a redirect location is not an application path (HY-46)"),
            Error::NotOutsideLocation => f.write_str("an outside location is not an http or https URL with a host (HY-132)"),
            Error::OutsideRedirectStores => f.write_str("an outside redirect holds no flash value or changed topic (HY-132)"),
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
            Error::InvalidSessionHandler => {
                f.write_str("collect removes the files of the handler files, and the session handler is another (HY-104)")
            }
            Error::SharedHoldsContext => f.write_str("the shared handler returned the key context (HY-124)"),
            Error::NotSelected => f.write_str("the request holds no selected media type (HY-116)"),
            Error::MalformedContentType => f.write_str("the Content-Type of the request is no media type (HY-59)"),
            Error::InvalidApplication(reason) | Error::InvalidBuild(reason) => f.write_str(reason),
            Error::InvalidRepresentation(reason) => write!(f, "{reason} (HY-122)"),
            Error::MalformedJson(error) => write!(f, "a JSON text is malformed: {error} (HY-54)"),
            Error::DataModel(error) => error.fmt(f),
            Error::Template(error) => error.fmt(f),
            Error::Sessions(error) => error.fmt(f),
            Error::RecordValue(error) => write!(f, "an invariant of a session record does not hold: {error} (HY-133)"),
            Error::Negotiate(error) => error.fmt(f),
            Error::Cookies(error) => error.fmt(f),
            Error::Form(error) => error.fmt(f),
            Error::Internal(what) => write!(f, "an invariant of the core does not hold: {what} (HY-133)"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        if let Error::MalformedJson(error) = self {
            return Some(error);
        }
        match self.part() {
            Part::Negotiate(error) => Some(error),
            Part::Sessions(error) => Some(error),
            Part::RecordValue(error) => Some(error),
            Part::Template(error) => Some(error),
            Part::Cookies(error) => Some(error),
            Part::Form(error) => Some(error),
            Part::Own(..) | Part::DataModel(_) => None,
        }
    }
}

impl From<polyspec_http_negotiation::Error> for Error {
    fn from(error: polyspec_http_negotiation::Error) -> Self {
        Error::Negotiate(error)
    }
}

impl From<polyspec_http_form::Error> for Error {
    fn from(error: polyspec_http_form::Error) -> Self {
        Error::Form(error)
    }
}

impl From<polyspec_http_cookie::Error> for Error {
    fn from(error: polyspec_http_cookie::Error) -> Self {
        Error::Cookies(error)
    }
}

/// The category of a failure of the http-cookie library, as its interface contract gives it (E-1b). The match has no
/// wildcard, so a variant that the library adds does not compile until its category is stated.
fn cookies_category(error: polyspec_http_cookie::Error) -> Category {
    use polyspec_http_cookie::Error as Cookies;
    match error {
        Cookies::InvalidName
        | Cookies::InvalidCookiePath
        | Cookies::TooLarge
        | Cookies::PrefixNotMet
        | Cookies::SameSiteNoneNotSecure => Category::Value,
    }
}

/// The category of a failure of the session-store library, as its interface contract gives it (E-1b).
/// The category of a failure of http-form, as the error rows of its interface contract give it (F-9, F-11, F-25).
fn form_category(error: &polyspec_http_form::Error) -> Category {
    use polyspec_http_form::Error as Form;
    match error {
        Form::Internal(_) => Category::Internal,
        Form::NotFinished | Form::NotStreamed | Form::Finished => Category::Type,
        Form::Io(_) | Form::SourceLeft(_) | Form::PartialTarget { .. } => Category::Io,
        Form::Invalid
        | Form::HeaderLimit
        | Form::NoBoundary
        | Form::MalformedContentType(_)
        | Form::InvalidContentLength
        | Form::BodyLimit
        | Form::ValueLimit
        | Form::PartLimit
        | Form::FileLimit
        | Form::Moved
        | Form::Exists
        | Form::Removed => Category::Value,
    }
}

fn sessions_category(error: &polyspec_session_store::Error) -> Category {
    use polyspec_session_store::Error as Sessions;
    match error {
        Sessions::Internal { .. } => Category::Internal,
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
        Sessions::Random { .. }
        | Sessions::IdentifierTaken { .. }
        | Sessions::Cancelled
        | Sessions::Io { .. }
        | Sessions::Connection { .. } => Category::Io,
    }
}

/// The category of a kind of the template language, as its interface contract gives it (E-1b), for a failure of a
/// render and for a failure of the data model. The match has no wildcard, so a code that the language adds does not
/// compile until its category is stated.
fn template_category(code: polyspec_template::ErrorCode) -> Category {
    use polyspec_template::ErrorCode;
    match code {
        ErrorCode::LoadFailed => Category::Io,
        ErrorCode::DataUnsupportedType | ErrorCode::RuntimeType | ErrorCode::RuntimeArity => {
            Category::Type
        }
        ErrorCode::FormatInvariant | ErrorCode::Internal => Category::Internal,
        ErrorCode::LexInvalidUtf8
        | ErrorCode::ParseUnterminatedTag
        | ErrorCode::ParseUnterminatedComment
        | ErrorCode::ParseUnterminatedString
        | ErrorCode::ParseUnexpectedToken
        | ErrorCode::ParseInvalidNumber
        | ErrorCode::ParseInvalidEscape
        | ErrorCode::ParseUnexpectedClose
        | ErrorCode::ParseUnclosedBlock
        | ErrorCode::ParseElseOutsideBlock
        | ErrorCode::ParseDuplicateElse
        | ErrorCode::ParseElseifAfterElse
        | ErrorCode::ParseElseifNotInIf
        | ErrorCode::ParseReservedName
        | ErrorCode::ParseInvalidPath
        | ErrorCode::ParseInvalidBlockTag
        | ErrorCode::ParseInvalidWrapper
        | ErrorCode::ParseInvalidDirective
        | ErrorCode::LoadNotFound
        | ErrorCode::LoadCycle
        | ErrorCode::LoadOutsideRoot
        | ErrorCode::LoadNotLoaded
        | ErrorCode::DataNumberRange
        | ErrorCode::DataNumberNotFinite
        | ErrorCode::DataInvalidUtf8
        | ErrorCode::DataDepth
        | ErrorCode::DataInvalidJson
        | ErrorCode::RuntimeCompare
        | ErrorCode::RuntimeDivZero
        | ErrorCode::RuntimeStringify
        | ErrorCode::RuntimeUnknownFunction
        | ErrorCode::RuntimeHostFunction
        | ErrorCode::RuntimeUnknownLoop
        | ErrorCode::RuntimeBlockUndefined
        | ErrorCode::RuntimeBlockRedefined
        | ErrorCode::RuntimeDepth
        | ErrorCode::RuntimeLimit
        | ErrorCode::ArgumentDelimiters
        | ErrorCode::ArgumentFunctionName
        | ErrorCode::ArgumentSourceRange
        | ErrorCode::ArgumentIndent
        | ErrorCode::FormatHtml
        | ErrorCode::AstInvalid => Category::Value,
    }
}
