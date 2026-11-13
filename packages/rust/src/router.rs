//! Routing (HY-4 to HY-8, HY-49): route paths, the match of a request path and the base path.

use crate::Error;

/// A segment of a route path (HY-4.3, HY-49.1).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Segment {
    /// A literal, compared byte for byte (HY-5.1).
    Literal(String),
    /// A parameter `{name}`.
    Parameter(String),
    /// A rest parameter `{name*}`, the last segment (HY-49.1).
    Rest(String),
}

/// A checked route: its name and the segments of its path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub name: String,
    segments: Vec<Segment>,
}

/// The result of a match (HY-5.3): the name of the route and each parameter with its value, in the order of the
/// parameters in the route path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub name: String,
    pub params: Vec<(String, String)>,
}

/// Whether a literal holds only `A-Z a-z 0-9 . _ ~ -` and at least one of them (HY-4.3).
fn is_literal(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'))
}

/// Whether a name matches `[A-Za-z_][A-Za-z0-9_]*`, the form of a parameter name (HY-4.3) and of a topic and a map key
/// of a kept path (HY-37.3).
pub(crate) fn is_identifier(name: &str) -> bool {
    match name.as_bytes().split_first() {
        Some((first, rest)) => {
            (first.is_ascii_alphabetic() || *first == b'_')
                && rest
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        }
        None => false,
    }
}

/// Checks a route path (HY-4, HY-49) and makes its route.
///
/// # Errors
/// `invalid_application` for a path that does not start with `/`, an empty segment, a literal or a parameter name
/// outside HY-4.3, a repeated parameter name, and a rest parameter that is not the last segment (HY-4.6).
pub fn route(name: &str, path: &str) -> Result<Route, Error> {
    let Some(rest) = path.strip_prefix('/') else {
        return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
            "a route path starts with a slash (HY-4)",
        )));
    };
    let mut segments = Vec::new();
    if !rest.is_empty() {
        let parts: Vec<&str> = rest.split('/').collect();
        let last = parts.len().saturating_sub(1);
        for (index, part) in parts.iter().enumerate() {
            let segment = if let Some(inner) = part
                .strip_prefix('{')
                .and_then(|inner| inner.strip_suffix('}'))
            {
                if let Some(rest_name) = inner.strip_suffix('*') {
                    if index != last || !is_identifier(rest_name) {
                        return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                            "a rest parameter is a named last segment (HY-49)",
                        )));
                    }
                    Segment::Rest(rest_name.to_owned())
                } else if is_identifier(inner) {
                    Segment::Parameter(inner.to_owned())
                } else {
                    return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                        "a route parameter name is not allowed (HY-4)",
                    )));
                }
            } else if is_literal(part) {
                Segment::Literal((*part).to_owned())
            } else {
                return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                    "a route path segment is not allowed (HY-4)",
                )));
            };
            segments.push(segment);
        }
    }
    let mut names: Vec<&str> = Vec::new();
    for segment in &segments {
        let name = match segment {
            Segment::Parameter(name) | Segment::Rest(name) => name.as_str(),
            Segment::Literal(_) => continue,
        };
        if names.contains(&name) {
            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a route path repeats a parameter name (HY-4)",
            )));
        }
        names.push(name);
    }
    Ok(Route {
        name: name.to_owned(),
        segments,
    })
}

/// The value of a hexadecimal digit.
fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// A request segment with each `%XX` decoded to its byte (HY-6.1); none for a `%` without two hexadecimal digits
/// and for bytes that are not UTF-8 (HY-6.2).
fn decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while let Some(byte) = bytes.get(index) {
        if *byte == b'%' {
            let high = hex(*bytes.get(index + 1)?)?;
            let low = hex(*bytes.get(index + 2)?)?;
            decoded.push(high << 4 | low);
            index += 3;
        } else {
            decoded.push(*byte);
            index += 1;
        }
    }
    // HY-6.2: bytes that are not UTF-8 are no match, which is the one meaning of the absence.
    #[allow(
        clippy::disallowed_methods,
        reason = "HY-6.2: a segment that is not UTF-8 does not match"
    )]
    String::from_utf8(decoded).ok()
}

impl Route {
    /// The parameters of this route for a request path, or none when it does not match (HY-5, HY-6, HY-49).
    #[must_use]
    pub fn matches(&self, path: &str) -> Option<Vec<(String, String)>> {
        let rest = path.strip_prefix('/')?;
        let parts: Vec<&str> = if rest.is_empty() {
            Vec::new()
        } else {
            rest.split('/').collect()
        };
        let mut params = Vec::new();
        for (index, segment) in self.segments.iter().enumerate() {
            match segment {
                Segment::Literal(literal) => {
                    if parts.get(index) != Some(&literal.as_str()) {
                        return None;
                    }
                }
                Segment::Parameter(name) => {
                    let part = parts.get(index)?;
                    if part.is_empty() {
                        return None;
                    }
                    params.push((name.clone(), decode(part)?));
                }
                Segment::Rest(name) => {
                    let remaining: &[&str] = match parts.get(index..) {
                        Some(remaining) => remaining,
                        None => &[],
                    };
                    // HY-49.2: every remaining segment is empty or decodes.
                    for part in remaining {
                        if !part.is_empty() {
                            decode(part)?;
                        }
                    }
                    // HY-49.3: the rest of the path without decoding.
                    params.push((name.clone(), format!("/{}", remaining.join("/"))));
                    return Some(params);
                }
            }
        }
        if parts.len() == self.segments.len() {
            Some(params)
        } else {
            None
        }
    }
}

/// The routes of an application in manifest order (HY-7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Router {
    routes: Vec<Route>,
}

impl Router {
    /// Checks every route path (HY-4.6).
    ///
    /// # Errors
    /// The `invalid_application` of the first route path that HY-4 or HY-49 refuses.
    pub fn new(routes: &[(String, String)]) -> Result<Router, Error> {
        let routes = routes
            .iter()
            .map(|(name, path)| route(name, path))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Router { routes })
    }

    /// The first route that matches a request path, in manifest order, or none (HY-7).
    #[must_use]
    pub fn find(&self, path: &str) -> Option<Match> {
        self.routes.iter().find_map(|route| {
            route.matches(path).map(|params| Match {
                name: route.name.clone(),
                params,
            })
        })
    }

    /// The route of a request path under a base path (HY-8.2): the base path must be followed by `/` or the end of
    /// the path, and the rest, or `/` for the end, is routed.
    #[must_use]
    pub fn find_under(&self, base_path: &str, path: &str) -> Option<Match> {
        let rest = path.strip_prefix(base_path)?;
        if rest.is_empty() {
            self.find("/")
        } else if rest.starts_with('/') {
            self.find(rest)
        } else {
            None
        }
    }
}
