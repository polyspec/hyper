//! The representations of a route (HY-118, HY-121, HY-122): the check of a manifest entry, the methods of an entry,
//! the checks of a request before its handler and the response that its handler returns.

use polyspec_http_media_type::parse;

use crate::location::is_application_path;
use crate::reply::keeps_out_of_shared_caches;
use crate::Error;

/// A method that an entry may list (HY-118.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
}

impl Method {
    /// The method of a name, compared exactly as HY-118.2 writes it.
    #[must_use]
    pub fn of(name: &str) -> Option<Method> {
        match name {
            "GET" => Some(Method::Get),
            "POST" => Some(Method::Post),
            "PUT" => Some(Method::Put),
            "DELETE" => Some(Method::Delete),
            _ => None,
        }
    }
}

/// A checked entry of `representations` (HY-118.2): its type and subtype in lowercase, each required parameter in
/// lowercase with its served values, its methods and its `vary` names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub r#type: String,
    pub subtype: String,
    pub parameters: Vec<(String, Vec<Vec<u8>>)>,
    pub methods: Vec<Method>,
    pub vary: Vec<String>,
}

/// Whether the bytes are a token (RFC 9110, section 5.6.2).
fn is_token(bytes: &[u8]) -> bool {
    !bytes.is_empty()
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

/// Checks one entry of `representations` as the manifest check does (HY-118.5, HY-118.6).
///
/// # Errors
/// `invalid_application` for a type that is no media type without parameters (MT-4), that is `*` or one of the two
/// types of hyper, a parameter named `q`, given twice or without values, a served value outside HTAB, SP and U+0021 to
/// U+007E, an empty `methods` or a method outside `GET`, `POST`, `PUT` and `DELETE`, and a `vary` name that is no
/// token, is `Accept` or `Cookie`, or is given twice.
pub fn entry(
    media_type: &str,
    parameters: &[(String, Vec<String>)],
    methods: &[String],
    vary: &[String],
) -> Result<Entry, Error> {
    let parsed = match parse(media_type.as_bytes()) {
        Ok(parsed) if parsed.parameters.is_empty() => parsed,
        Ok(_) | Err(_) => {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a representation type is no media type (HY-118)",
            )))
        }
    };
    let full = format!("{}/{}", parsed.r#type, parsed.subtype);
    if full == crate::media::PAGE || full == crate::media::PAGE_DATA {
        return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
            "a representation type is a type of hyper (HY-118)",
        )));
    }
    let mut checked: Vec<(String, Vec<Vec<u8>>)> = Vec::with_capacity(parameters.len());
    for (name, values) in parameters {
        let lower = name.to_ascii_lowercase();
        if !is_token(name.as_bytes())
            || lower == "q"
            || checked.iter().any(|(other, _)| other == &lower)
        {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a representation parameter name is not allowed (HY-118)",
            )));
        }
        if values.is_empty() {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a representation parameter has no served value (HY-118)",
            )));
        }
        let mut served: Vec<Vec<u8>> = Vec::with_capacity(values.len());
        for value in values {
            // HY-118.6: a header carries another character in bytes that differ between UTF-8 and ISO-8859-1.
            if value.is_empty()
                || !value
                    .bytes()
                    .all(|byte| byte == b'\t' || (0x20..=0x7e).contains(&byte))
            {
                return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                    "a served value has a character that is not allowed (HY-118)",
                )));
            }
            // NG-7.3: two equal values of one parameter give the weigher no candidate.
            if served
                .iter()
                .any(|other| polyspec_http_media_type::same_value(&lower, other, value.as_bytes()))
            {
                return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                    "a served value is given twice (HY-118)",
                )));
            }
            served.push(value.as_bytes().to_vec());
        }
        checked.push((lower, served));
    }
    if methods.is_empty() {
        return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
            "a representation has no method (HY-118)",
        )));
    }
    let mut listed = Vec::with_capacity(methods.len());
    for method in methods {
        match Method::of(method) {
            Some(method) => listed.push(method),
            None => {
                return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                    "a representation method is not GET, POST, PUT or DELETE (HY-118)",
                )))
            }
        }
    }
    let mut names: Vec<String> = Vec::with_capacity(vary.len());
    for name in vary {
        let lower = name.to_ascii_lowercase();
        if !is_token(name.as_bytes())
            || lower == "accept"
            || lower == "cookie"
            || names.iter().any(|other| other.eq_ignore_ascii_case(name))
        {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a vary name is not allowed (HY-118)",
            )));
        }
        names.push(name.clone());
    }
    Ok(Entry {
        r#type: parsed.r#type,
        subtype: parsed.subtype,
        parameters: checked,
        methods: listed,
        vary: names,
    })
}

/// Checks the entries of one route (HY-118.5): no type twice, compared without case.
///
/// # Errors
/// `invalid_application`.
pub fn entries(entries: Vec<Entry>) -> Result<Vec<Entry>, Error> {
    for (index, entry) in entries.iter().enumerate() {
        if entries[..index]
            .iter()
            .any(|other| other.r#type == entry.r#type && other.subtype == entry.subtype)
        {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a route declares a representation type twice (HY-118)",
            )));
        }
    }
    Ok(entries)
}

/// The methods that an entry answers in the order `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, as `Allow` lists them
/// (HY-121.6); an entry with `GET` also answers `HEAD` (HY-118.3).
#[must_use]
pub fn allow(entry: &Entry) -> String {
    let mut names: Vec<&str> = Vec::new();
    if entry.methods.contains(&Method::Get) {
        names.push("GET");
        names.push("HEAD");
    }
    for (method, name) in [
        (Method::Post, "POST"),
        (Method::Put, "PUT"),
        (Method::Delete, "DELETE"),
    ] {
        if entry.methods.contains(&method) {
            names.push(name);
        }
    }
    names.join(", ")
}

/// Whether an entry answers a request method (HY-121.6, HY-118.3).
#[must_use]
pub fn answers(entry: &Entry, method: &str) -> bool {
    match method {
        "HEAD" => entry.methods.contains(&Method::Get),
        other => match Method::of(other) {
            Some(method) => entry.methods.contains(&method),
            None => false,
        },
    }
}

/// The answer of the checks of a representation request before its handler (HY-121.4, HY-121.7, HY-121.11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyCheck {
    /// The handler runs; `json` tells whether it reads the body as JSON (HY-121.9).
    Run { json: bool },
    /// 400 with the text `Bad Request`.
    BadRequest,
    /// 415.
    UnsupportedMediaType,
}

/// The checks of the body of a representation request (HY-121.7, HY-121.11): a `GET`, `HEAD` or `DELETE` with a body
/// size other than 0 is a 400; a `POST` or `PUT` without `Content-Type`, or whose media type (MT-4) is not
/// `application/json`, is a 415, and one whose `Content-Type` is no media type is a 400. The JSON text of the body is
/// read after these checks (HY-54.20).
#[must_use]
pub fn body_check(method: &str, size: u64, content_type: Option<&[u8]>) -> BodyCheck {
    match method {
        "POST" | "PUT" => match content_type {
            None => BodyCheck::UnsupportedMediaType,
            Some(value) => match parse(value) {
                Ok(media) if media.r#type == "application" && media.subtype == "json" => {
                    BodyCheck::Run { json: true }
                }
                Ok(_) => BodyCheck::UnsupportedMediaType,
                Err(_) => BodyCheck::BadRequest,
            },
        },
        _ => {
            if size == 0 {
                BodyCheck::Run { json: false }
            } else {
                BodyCheck::BadRequest
            }
        }
    }
}

/// The statuses that a representation handler may return (HY-122.2).
pub const STATUSES: [u16; 13] = [
    200, 201, 204, 400, 401, 403, 404, 406, 409, 412, 415, 422, 428,
];

/// The headers of the response of a representation handler after the checks of HY-122.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checked {
    pub status: u16,
    /// `Cache-Control`, `Location` and `WWW-Authenticate`, in this order, each when the response has it.
    pub headers: Vec<(String, String)>,
}

/// Whether a `Location` is an absolute URI (RFC 3986, section 4.3): a scheme, a colon and no fragment.
fn is_absolute_uri(location: &str) -> bool {
    let Some(colon) = location.find(':') else {
        return false;
    };
    let scheme = &location.as_bytes()[..colon];
    match scheme.split_first() {
        Some((first, rest)) => {
            first.is_ascii_alphabetic()
                && rest
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
                && !location.contains('#')
        }
        None => false,
    }
}

/// Checks what a representation handler returned (HY-122.2 to HY-122.8): its status, whether it has a body, and its
/// headers by name as written; `authorized` tells whether the request has `Authorization`, and `base_path` is the base
/// path that an application path of `Location` gets (HY-122.5).
///
/// # Errors
/// `invalid_representation` for another status, another header, a 401 without `WWW-Authenticate`, a 201 without
/// `Location`, a 204 with a body, a 200 without one, a `Cache-Control` on a status of 400 or more or one that lets a
/// shared cache store the response of a request with `Authorization`, and a `Location` that is neither an absolute URI
/// nor an application path.
pub fn response(
    status: u16,
    has_body: bool,
    headers: &[(String, String)],
    authorized: bool,
    base_path: &str,
) -> Result<Checked, Error> {
    if !STATUSES.contains(&status) {
        return Err(Error::InvalidRepresentation(
            "a representation handler returned a status that is not allowed",
        ));
    }
    let mut location = None;
    let mut challenge = None;
    let mut cache_control = None;
    for (name, value) in headers {
        match name.to_ascii_lowercase().as_str() {
            "location" => location = Some(value.as_str()),
            "www-authenticate" => challenge = Some(value.as_str()),
            "cache-control" => cache_control = Some(value.as_str()),
            _ => {
                return Err(Error::InvalidRepresentation(
                    "a representation handler set a header that is not allowed",
                ))
            }
        }
    }
    if status == 401 && challenge.is_none() {
        return Err(Error::InvalidRepresentation(
            "a 401 of a representation has no WWW-Authenticate",
        ));
    }
    if status == 201 && location.is_none() {
        return Err(Error::InvalidRepresentation(
            "a 201 of a representation has no Location",
        ));
    }
    if status == 204 && has_body {
        return Err(Error::InvalidRepresentation(
            "a 204 of a representation has a body",
        ));
    }
    if status == 200 && !has_body {
        return Err(Error::InvalidRepresentation(
            "a 200 of a representation has no body",
        ));
    }
    let policy = match (status >= 400, cache_control) {
        (true, Some(_)) => {
            return Err(Error::InvalidRepresentation(
                "a representation handler set Cache-Control on a failure",
            ))
        }
        (true, None) => "no-store".to_owned(),
        (false, None) if authorized => "private, no-cache".to_owned(),
        (false, None) => "no-cache".to_owned(),
        (false, Some(value)) => {
            if authorized && !keeps_out_of_shared_caches(value) {
                return Err(Error::InvalidRepresentation(
                    "a Cache-Control of a representation lets a shared cache store the response of a request with \
                     Authorization",
                ));
            }
            value.to_owned()
        }
    };
    let mut written = vec![("Cache-Control".to_owned(), policy)];
    if let Some(location) = location {
        let sent = if is_absolute_uri(location) {
            location.to_owned()
        } else if is_application_path(location) {
            format!("{base_path}{location}")
        } else {
            return Err(Error::InvalidRepresentation(
                "a Location of a representation is no absolute URI and no application path",
            ));
        };
        written.push(("Location".to_owned(), sent));
    }
    if let Some(challenge) = challenge {
        written.push(("WWW-Authenticate".to_owned(), challenge.to_owned()));
    }
    Ok(Checked {
        status,
        headers: written,
    })
}
