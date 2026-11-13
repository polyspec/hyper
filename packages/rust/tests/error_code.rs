//! The code of an error (HY-132.1, HY-132.3): `Error::code` gives the variant of `ErrorCode` that the interface contract
//! lists as the kind of the failure (binding GN-7b), and a failure of a library that hyper passes on is the variant of
//! that library with the code of the library (binding GN-7c). Each match below has no wildcard, so a variant that a
//! library adds does not compile until the contract has its row.

use std::collections::BTreeSet;
use std::path::PathBuf;

use polyspec_http_cookie::Error as Cookie;
use polyspec_http_negotiation::Error as Negotiation;
use polyspec_hyper::{Error, ErrorCode};
use polyspec_session_store::Error as Sessions;
use polyspec_template::ErrorCode as Template;

fn contract() -> Result<serde_json::Value, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("interface.json");
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
}

/// The variants of the rows of `errors.kinds` with `library`, or of the rows without one.
fn rows(contract: &serde_json::Value, library: Option<&str>) -> BTreeSet<String> {
    contract["errors"]["kinds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["library"].as_str() == library)
        .filter_map(|row| row["variant"].as_str().map(str::to_owned))
        .collect()
}

fn text() -> String {
    "a detail".to_owned()
}

/// The name of the variant of a code of hyper.
fn name(code: ErrorCode<'_>) -> &'static str {
    match code {
        ErrorCode::NotApplicationPath => "NotApplicationPath",
        ErrorCode::NotRedirectResult => "NotRedirectResult",
        ErrorCode::PageStatusNotAllowed => "PageStatusNotAllowed",
        ErrorCode::ReplyStatusNotAllowed => "ReplyStatusNotAllowed",
        ErrorCode::CookieNameNotAllowed => "CookieNameNotAllowed",
        ErrorCode::CookieValueNotAllowed => "CookieValueNotAllowed",
        ErrorCode::NegativeMaxAge => "NegativeMaxAge",
        ErrorCode::IntegerRange => "IntegerRange",
        ErrorCode::CacheControlNotAllowed => "CacheControlNotAllowed",
        ErrorCode::CacheControlShared => "CacheControlShared",
        ErrorCode::ReferrerPolicyNotAllowed => "ReferrerPolicyNotAllowed",
        ErrorCode::InvalidCsrfForm => "InvalidCsrfForm",
        ErrorCode::InvalidSessionToken => "InvalidSessionToken",
        ErrorCode::InvalidSessionRecord => "InvalidSessionRecord",
        ErrorCode::SharedHoldsContext => "SharedHoldsContext",
        ErrorCode::NotSelected => "NotSelected",
        ErrorCode::InvalidApplication => "InvalidApplication",
        ErrorCode::InvalidBuild => "InvalidBuild",
        ErrorCode::InvalidRepresentation => "InvalidRepresentation",
        ErrorCode::Internal => "Internal",
        ErrorCode::RecordValue => "RecordValue",
        ErrorCode::Template(_) => "Template",
        ErrorCode::Sessions(_) => "Sessions",
        ErrorCode::Negotiate(_) => "Negotiate",
        ErrorCode::Cookies(_) => "Cookies",
    }
}

fn template_name(code: Template) -> &'static str {
    match code {
        Template::LexInvalidUtf8 => "LexInvalidUtf8",
        Template::ParseUnterminatedTag => "ParseUnterminatedTag",
        Template::ParseUnterminatedComment => "ParseUnterminatedComment",
        Template::ParseUnterminatedString => "ParseUnterminatedString",
        Template::ParseUnexpectedToken => "ParseUnexpectedToken",
        Template::ParseInvalidNumber => "ParseInvalidNumber",
        Template::ParseInvalidEscape => "ParseInvalidEscape",
        Template::ParseUnexpectedClose => "ParseUnexpectedClose",
        Template::ParseUnclosedBlock => "ParseUnclosedBlock",
        Template::ParseElseOutsideBlock => "ParseElseOutsideBlock",
        Template::ParseDuplicateElse => "ParseDuplicateElse",
        Template::ParseElseifAfterElse => "ParseElseifAfterElse",
        Template::ParseElseifNotInIf => "ParseElseifNotInIf",
        Template::ParseReservedName => "ParseReservedName",
        Template::ParseInvalidPath => "ParseInvalidPath",
        Template::ParseInvalidBlockTag => "ParseInvalidBlockTag",
        Template::ParseInvalidWrapper => "ParseInvalidWrapper",
        Template::ParseInvalidDirective => "ParseInvalidDirective",
        Template::LoadNotFound => "LoadNotFound",
        Template::LoadCycle => "LoadCycle",
        Template::LoadOutsideRoot => "LoadOutsideRoot",
        Template::LoadFailed => "LoadFailed",
        Template::LoadNotLoaded => "LoadNotLoaded",
        Template::DataNumberRange => "DataNumberRange",
        Template::DataNumberNotFinite => "DataNumberNotFinite",
        Template::DataInvalidUtf8 => "DataInvalidUtf8",
        Template::DataUnsupportedType => "DataUnsupportedType",
        Template::DataDepth => "DataDepth",
        Template::DataInvalidJson => "DataInvalidJson",
        Template::RuntimeType => "RuntimeType",
        Template::RuntimeCompare => "RuntimeCompare",
        Template::RuntimeDivZero => "RuntimeDivZero",
        Template::RuntimeStringify => "RuntimeStringify",
        Template::RuntimeUnknownFunction => "RuntimeUnknownFunction",
        Template::RuntimeArity => "RuntimeArity",
        Template::RuntimeHostFunction => "RuntimeHostFunction",
        Template::RuntimeUnknownLoop => "RuntimeUnknownLoop",
        Template::RuntimeBlockUndefined => "RuntimeBlockUndefined",
        Template::RuntimeBlockRedefined => "RuntimeBlockRedefined",
        Template::RuntimeDepth => "RuntimeDepth",
        Template::RuntimeLimit => "RuntimeLimit",
        Template::ArgumentDelimiters => "ArgumentDelimiters",
        Template::ArgumentFunctionName => "ArgumentFunctionName",
        Template::ArgumentSourceRange => "ArgumentSourceRange",
        Template::ArgumentIndent => "ArgumentIndent",
        Template::FormatInvariant => "FormatInvariant",
        Template::FormatHtml => "FormatHtml",
        Template::AstInvalid => "AstInvalid",
        Template::Internal => "Internal",
    }
}

fn sessions_name(error: &Sessions) -> &'static str {
    match error {
        Sessions::Random { .. } => "Random",
        Sessions::Record { .. } => "Record",
        Sessions::RecordNotArray { .. } => "RecordNotArray",
        Sessions::RecordWrite { .. } => "RecordWrite",
        Sessions::InvalidDirectory { .. } => "InvalidDirectory",
        Sessions::InvalidLifetime => "InvalidLifetime",
        Sessions::Cancelled => "Cancelled",
        Sessions::IdentifierTaken { .. } => "IdentifierTaken",
        Sessions::Io { .. } => "Io",
        Sessions::InvalidLockExpire => "InvalidLockExpire",
        Sessions::InvalidSetting { .. } => "InvalidSetting",
        Sessions::LockTimeout { .. } => "LockTimeout",
        Sessions::LockLost { .. } => "LockLost",
        Sessions::Reply { .. } => "Reply",
        Sessions::Redis { .. } => "Redis",
        Sessions::Connection { .. } => "Connection",
        Sessions::Internal { .. } => "Internal",
    }
}

fn negotiation_name(error: Negotiation) -> &'static str {
    match error {
        Negotiation::InvalidAccept => "InvalidAccept",
        Negotiation::InvalidWeight => "InvalidWeight",
        Negotiation::InvalidCandidate => "InvalidCandidate",
        Negotiation::Internal => "Internal",
    }
}

fn cookie_name(error: Cookie) -> &'static str {
    match error {
        Cookie::InvalidName => "InvalidName",
        Cookie::InvalidCookiePath => "InvalidCookiePath",
        Cookie::TooLarge => "TooLarge",
        Cookie::PrefixNotMet => "PrefixNotMet",
        Cookie::SameSiteNoneNotSecure => "SameSiteNoneNotSecure",
    }
}

#[test]
fn the_contract_names_the_projection_to_the_code() -> Result<(), String> {
    let contract = contract()?;
    assert_eq!(
        contract["errors"]["code"],
        serde_json::json!({"error": "polyspec_hyper::Error", "path": "polyspec_hyper::Error::code"})
    );
    Ok(())
}

#[test]
fn a_failure_of_hyper_projects_to_its_own_code_which_the_contract_lists() -> Result<(), String> {
    let failures = [
        (Error::NotApplicationPath, ErrorCode::NotApplicationPath),
        (Error::NotRedirectResult, ErrorCode::NotRedirectResult),
        (
            Error::PageStatusNotAllowed(500),
            ErrorCode::PageStatusNotAllowed,
        ),
        (
            Error::ReplyStatusNotAllowed(500),
            ErrorCode::ReplyStatusNotAllowed,
        ),
        (
            Error::CookieNameNotAllowed("a".to_owned()),
            ErrorCode::CookieNameNotAllowed,
        ),
        (
            Error::CookieValueNotAllowed("a".to_owned()),
            ErrorCode::CookieValueNotAllowed,
        ),
        (
            Error::NegativeMaxAge("a".to_owned()),
            ErrorCode::NegativeMaxAge,
        ),
        (Error::IntegerRange, ErrorCode::IntegerRange),
        (
            Error::CacheControlNotAllowed,
            ErrorCode::CacheControlNotAllowed,
        ),
        (
            Error::CacheControlShared("public".to_owned()),
            ErrorCode::CacheControlShared,
        ),
        (
            Error::ReferrerPolicyNotAllowed("a b".to_owned()),
            ErrorCode::ReferrerPolicyNotAllowed,
        ),
        (Error::InvalidCsrfForm, ErrorCode::InvalidCsrfForm),
        (Error::InvalidSessionToken, ErrorCode::InvalidSessionToken),
        (Error::InvalidSessionRecord, ErrorCode::InvalidSessionRecord),
        (Error::SharedHoldsContext, ErrorCode::SharedHoldsContext),
        (Error::NotSelected, ErrorCode::NotSelected),
        (
            Error::InvalidApplication("a reason".into()),
            ErrorCode::InvalidApplication,
        ),
        (
            Error::InvalidBuild("a reason".into()),
            ErrorCode::InvalidBuild,
        ),
        (
            Error::InvalidRepresentation("a reason"),
            ErrorCode::InvalidRepresentation,
        ),
        (Error::Internal("an invariant"), ErrorCode::Internal),
        (
            Error::RecordValue(polyspec_php_serialization::Error::ArrayHeld),
            ErrorCode::RecordValue,
        ),
    ];
    let mut expected = BTreeSet::new();
    for (error, code) in &failures {
        assert_eq!(error.code(), *code);
        expected.insert(format!("polyspec_hyper::ErrorCode::{}", name(*code)));
    }
    assert_eq!(expected.len(), failures.len());
    assert_eq!(rows(&contract()?, None), expected);
    Ok(())
}

#[test]
fn every_code_of_the_template_language_projects_to_template_and_has_its_row() -> Result<(), String>
{
    let codes = [
        Template::LexInvalidUtf8,
        Template::ParseUnterminatedTag,
        Template::ParseUnterminatedComment,
        Template::ParseUnterminatedString,
        Template::ParseUnexpectedToken,
        Template::ParseInvalidNumber,
        Template::ParseInvalidEscape,
        Template::ParseUnexpectedClose,
        Template::ParseUnclosedBlock,
        Template::ParseElseOutsideBlock,
        Template::ParseDuplicateElse,
        Template::ParseElseifAfterElse,
        Template::ParseElseifNotInIf,
        Template::ParseReservedName,
        Template::ParseInvalidPath,
        Template::ParseInvalidBlockTag,
        Template::ParseInvalidWrapper,
        Template::ParseInvalidDirective,
        Template::LoadNotFound,
        Template::LoadCycle,
        Template::LoadOutsideRoot,
        Template::LoadFailed,
        Template::LoadNotLoaded,
        Template::DataNumberRange,
        Template::DataNumberNotFinite,
        Template::DataInvalidUtf8,
        Template::DataUnsupportedType,
        Template::DataDepth,
        Template::DataInvalidJson,
        Template::RuntimeType,
        Template::RuntimeCompare,
        Template::RuntimeDivZero,
        Template::RuntimeStringify,
        Template::RuntimeUnknownFunction,
        Template::RuntimeArity,
        Template::RuntimeHostFunction,
        Template::RuntimeUnknownLoop,
        Template::RuntimeBlockUndefined,
        Template::RuntimeBlockRedefined,
        Template::RuntimeDepth,
        Template::RuntimeLimit,
        Template::ArgumentDelimiters,
        Template::ArgumentFunctionName,
        Template::ArgumentSourceRange,
        Template::ArgumentIndent,
        Template::FormatInvariant,
        Template::FormatHtml,
        Template::AstInvalid,
        Template::Internal,
    ];
    let mut expected = BTreeSet::new();
    for code in codes {
        let render = Error::Template(polyspec_template::TemplateError {
            code,
            template: "page".to_owned(),
            line: 0,
            col: 0,
            offset: 0,
            end: 0,
            message: text(),
        });
        let data = Error::DataModel(polyspec_template::BindError {
            code,
            message: text(),
        });
        assert_eq!(render.code(), ErrorCode::Template(code));
        assert_eq!(data.code(), ErrorCode::Template(code));
        assert_eq!(name(render.code()), "Template");
        expected.insert(format!(
            "polyspec_hyper::ErrorCode::Template/polyspec_template::ErrorCode::{}",
            template_name(code)
        ));
    }
    assert_eq!(expected.len(), codes.len());
    assert_eq!(rows(&contract()?, Some("template")), expected);
    Ok(())
}

#[test]
fn every_failure_of_session_store_projects_to_sessions_and_has_its_row() -> Result<(), String> {
    let failures = [
        Sessions::Random { detail: text() },
        Sessions::Record {
            id: text(),
            source: polyspec_php_serialization::Error::ArrayHeld,
        },
        Sessions::RecordNotArray { id: text() },
        Sessions::RecordWrite {
            source: polyspec_php_serialization::Error::ArrayHeld,
        },
        Sessions::InvalidDirectory {
            path: PathBuf::from("a"),
            detail: text(),
        },
        Sessions::InvalidLifetime,
        Sessions::Cancelled,
        Sessions::IdentifierTaken { id: text() },
        Sessions::Io {
            kind: polyspec_session_store::IoKind::Io,
            operation: "read",
            path: PathBuf::from("a"),
            errno: None,
            detail: text(),
        },
        Sessions::InvalidLockExpire,
        Sessions::InvalidSetting { detail: text() },
        Sessions::LockTimeout { key: text() },
        Sessions::LockLost { key: text() },
        Sessions::Reply {
            command: "GET",
            found: "an integer",
        },
        Sessions::Redis {
            command: "GET",
            message: text(),
        },
        Sessions::Connection { detail: text() },
        Sessions::Internal {
            what: "an invariant",
        },
    ];
    let mut expected = BTreeSet::new();
    for failure in &failures {
        let error = Error::Sessions(failure.clone());
        assert_eq!(error.code(), ErrorCode::Sessions(failure));
        assert_eq!(name(error.code()), "Sessions");
        expected.insert(format!(
            "polyspec_hyper::ErrorCode::Sessions/polyspec_session_store::Error::{}",
            sessions_name(failure)
        ));
    }
    assert_eq!(expected.len(), failures.len());
    assert_eq!(rows(&contract()?, Some("session-store")), expected);
    Ok(())
}

#[test]
fn every_failure_of_http_negotiation_projects_to_negotiate_and_has_its_row() -> Result<(), String> {
    let failures = [
        Negotiation::InvalidAccept,
        Negotiation::InvalidWeight,
        Negotiation::InvalidCandidate,
        Negotiation::Internal,
    ];
    let mut expected = BTreeSet::new();
    for failure in failures {
        let error = Error::Negotiate(failure);
        assert_eq!(error.code(), ErrorCode::Negotiate(failure));
        assert_eq!(name(error.code()), "Negotiate");
        expected.insert(format!(
            "polyspec_hyper::ErrorCode::Negotiate/polyspec_http_negotiation::Error::{}",
            negotiation_name(failure)
        ));
    }
    assert_eq!(expected.len(), failures.len());
    assert_eq!(rows(&contract()?, Some("http-negotiation")), expected);
    Ok(())
}

#[test]
fn every_failure_of_http_cookie_projects_to_cookies_and_has_its_row() -> Result<(), String> {
    let failures = [
        Cookie::InvalidName,
        Cookie::InvalidCookiePath,
        Cookie::TooLarge,
        Cookie::PrefixNotMet,
        Cookie::SameSiteNoneNotSecure,
    ];
    let mut expected = BTreeSet::new();
    for failure in failures {
        let error = Error::Cookies(failure);
        assert_eq!(error.code(), ErrorCode::Cookies(failure));
        assert_eq!(name(error.code()), "Cookies");
        expected.insert(format!(
            "polyspec_hyper::ErrorCode::Cookies/polyspec_http_cookie::Error::{}",
            cookie_name(failure)
        ));
    }
    assert_eq!(expected.len(), failures.len());
    assert_eq!(rows(&contract()?, Some("http-cookie")), expected);
    Ok(())
}
