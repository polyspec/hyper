//! The code of an error (HY-132.1, HY-132.3): `Error::code` gives the variant of `ErrorCode` that the interface contract
//! lists as the kind of the failure (binding GN-7b), and a failure of a library that hyper passes on is the variant of
//! that library with the code of the library (binding GN-7c). Each match below has no wildcard, so a variant that a
//! library adds does not compile until the contract has its row.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

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

/// Every code of the template language.
fn template_codes() -> [Template; 49] {
    [
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
    ]
}

/// A failure of every variant of session-store.
fn session_failures() -> [Sessions; 17] {
    [
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
    ]
}

/// Every failure of http-negotiation.
fn negotiation_failures() -> [Negotiation; 4] {
    [
        Negotiation::InvalidAccept,
        Negotiation::InvalidWeight,
        Negotiation::InvalidCandidate,
        Negotiation::Internal,
    ]
}

/// Every failure of http-cookie.
fn cookie_failures() -> [Cookie; 5] {
    [
        Cookie::InvalidName,
        Cookie::InvalidCookiePath,
        Cookie::TooLarge,
        Cookie::PrefixNotMet,
        Cookie::SameSiteNoneNotSecure,
    ]
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
    let codes = template_codes();
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
    let failures = session_failures();
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
    let failures = negotiation_failures();
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
    let failures = cookie_failures();
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

/// The categories that the interface contract of a library gives its kinds, by the name of the variant of each row of
/// `errors.kinds`. The contract is the `interface.json` beside the manifest of the package `polyspec-<library>` that
/// Cargo resolved for the core (binding I-1), which `cargo metadata` names: it is the contract of the code that the
/// core is built with, so a lock that moves to another commit of the library moves the table with it.
fn library_categories(library: &str) -> Result<BTreeMap<String, String>, String> {
    static METADATA: OnceLock<Result<serde_json::Value, String>> = OnceLock::new();
    let metadata = METADATA
        .get_or_init(|| {
            let cargo = std::env::var_os("CARGO").ok_or("cargo gave the test no CARGO")?;
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
            let output = Command::new(cargo)
                .args([
                    "metadata",
                    "--format-version",
                    "1",
                    "--locked",
                    "--offline",
                    "--manifest-path",
                ])
                .arg(&manifest)
                .output()
                .map_err(|error| format!("cargo metadata: {error}"))?;
            if !output.status.success() {
                return Err(format!(
                    "cargo metadata of {} failed: {}",
                    manifest.display(),
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            serde_json::from_slice(&output.stdout)
                .map_err(|error| format!("cargo metadata: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let package = format!("polyspec-{library}");
    let manifest = metadata["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|found| found["name"].as_str() == Some(package.as_str()))
        .and_then(|found| found["manifest_path"].as_str())
        .ok_or_else(|| format!("cargo metadata names no package {package}"))?;
    let path = PathBuf::from(manifest).with_file_name("interface.json");
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let contract: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut categories = BTreeMap::new();
    for row in contract["errors"]["kinds"].as_array().into_iter().flatten() {
        let variant = row["variant"]
            .as_str()
            .and_then(|variant| variant.rsplit("::").next())
            .ok_or_else(|| format!("{}: a row of errors.kinds names no variant", path.display()))?;
        let category = row["category"]
            .as_str()
            .ok_or_else(|| format!("{}: the row {variant} names no category", path.display()))?;
        if categories
            .insert(variant.to_owned(), category.to_owned())
            .is_some()
        {
            return Err(format!(
                "{}: two rows name the variant {variant}",
                path.display()
            ));
        }
    }
    Ok(categories)
}

/// The differences between the categories that the core gives the failures of a library and those of its contract: a
/// variant without a row, a row without a variant, and a category that differs.
fn category_differences(
    library: &str,
    given: &[(&'static str, &Error)],
) -> Result<Vec<String>, String> {
    let categories = library_categories(library)?;
    let mut differences = Vec::new();
    let mut named = BTreeSet::new();
    for (variant, error) in given {
        named.insert((*variant).to_owned());
        match categories.get(*variant) {
            Some(category) if category == error.category().as_str() => {}
            Some(category) => differences.push(format!(
                "{library} {variant}: the core gives {} and the contract of the library {category}",
                error.category().as_str()
            )),
            None => differences.push(format!(
                "{library} {variant}: the contract of the library has no row"
            )),
        }
    }
    for variant in categories
        .keys()
        .filter(|variant| !named.contains(*variant))
    {
        differences.push(format!(
            "{library} {variant}: the core passes on no such variant"
        ));
    }
    Ok(differences)
}

/// HY-132.1, binding E-1b: a failure that a library gives keeps the category that the contract of the library gives
/// its kind, for every variant of the four libraries and for both carriers of a code of the template language.
#[test]
fn a_failure_of_a_library_has_the_category_of_the_contract_of_the_library() -> Result<(), String> {
    let mut differences = Vec::new();
    let renders: Vec<(&'static str, Error)> = template_codes()
        .into_iter()
        .map(|code| {
            let error = Error::Template(polyspec_template::TemplateError {
                code,
                template: "page".to_owned(),
                line: 0,
                col: 0,
                offset: 0,
                end: 0,
                message: text(),
            });
            (template_name(code), error)
        })
        .collect();
    let data: Vec<(&'static str, Error)> = template_codes()
        .into_iter()
        .map(|code| {
            let error = Error::DataModel(polyspec_template::BindError {
                code,
                message: text(),
            });
            (template_name(code), error)
        })
        .collect();
    let sessions: Vec<(&'static str, Error)> = session_failures()
        .into_iter()
        .map(|failure| (sessions_name(&failure), Error::Sessions(failure)))
        .collect();
    let negotiation: Vec<(&'static str, Error)> = negotiation_failures()
        .into_iter()
        .map(|failure| (negotiation_name(failure), Error::Negotiate(failure)))
        .collect();
    let cookies: Vec<(&'static str, Error)> = cookie_failures()
        .into_iter()
        .map(|failure| (cookie_name(failure), Error::Cookies(failure)))
        .collect();
    for (library, given) in [
        ("template", &renders),
        ("template", &data),
        ("session-store", &sessions),
        ("http-negotiation", &negotiation),
        ("http-cookie", &cookies),
    ] {
        assert!(!given.is_empty());
        let borrowed: Vec<(&'static str, &Error)> = given
            .iter()
            .map(|(variant, error)| (*variant, error))
            .collect();
        differences.extend(category_differences(library, &borrowed)?);
    }
    assert_eq!(differences, Vec::<String>::new());
    Ok(())
}
