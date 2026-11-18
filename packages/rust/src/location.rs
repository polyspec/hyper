//! Application paths (HY-46): the locations that a redirect of the application may name.

use crate::Error;

/// Whether `location` is an application path (HY-46.1): it starts with `/`, its second character is neither `/` nor
/// `\`, it holds no control character (C0, DEL or C1), no space and no `\`, and its path, the text before its first `?`
/// or `#`, has no segment `.` or `..`, also when a dot is written as `%2e` in any case.
#[must_use]
pub fn is_application_path(location: &str) -> bool {
    let mut characters = location.chars();
    if characters.next() != Some('/') {
        return false;
    }
    if matches!(characters.next(), Some('/' | '\\')) {
        return false;
    }
    if location
        .chars()
        .any(|character| character.is_control() || character == ' ' || character == '\\')
    {
        return false;
    }
    let end = match location.find(['?', '#']) {
        Some(end) => end,
        None => location.len(),
    };
    let path = &location[..end];
    !path.split('/').any(is_dot_segment)
}

/// Whether a segment is `.` or `..` once each `%2e` of any case is read as a dot (HY-46.1).
fn is_dot_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    let dots = lower.replace("%2e", ".");
    dots == "." || dots == ".."
}

/// Checks a redirect location (HY-46.3).
///
/// # Errors
/// `not_application_path` for a location that is no application path.
pub fn redirect_location(location: &str) -> Result<&str, Error> {
    if is_application_path(location) {
        Ok(location)
    } else {
        Err(Error::NotApplicationPath)
    }
}

/// Checks the status of a result page (HY-58.6): 200, 409 or 422.
///
/// # Errors
/// `page_status_not_allowed` for another status.
pub fn page_status(status: i64) -> Result<u16, Error> {
    match status {
        200 => Ok(200),
        409 => Ok(409),
        422 => Ok(422),
        other => Err(Error::PageStatusNotAllowed(other)),
    }
}

/// The parts of an outside location (HY-132.2): its scheme in lower case, its host in lower case and its port, the
/// port of the location or the default port of its scheme.
fn outside_parts(text: &str) -> Option<(String, String, u32)> {
    if !text.is_ascii() {
        return None;
    }
    let (scheme, after) = text.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    let default = match scheme.as_str() {
        "http" => 80,
        "https" => 443,
        _ => return None,
    };
    // The authority ends at the first `/`, `?` or `#`, or at the end of a location without a rest (HY-132.2).
    let end = match after.find(['/', '?', '#']) {
        Some(end) => end,
        None => after.len(),
    };
    let (authority, rest) = after.split_at(end);
    if rest
        .bytes()
        .any(|byte| !(0x21..=0x7e).contains(&byte) || byte == b'\\')
    {
        return None;
    }
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    let label = |label: &str| {
        !label.is_empty()
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    };
    if !host.split('.').all(label) {
        return None;
    }
    let port = match port {
        None => default,
        Some(port) => {
            if port.is_empty()
                || port.len() > 5
                || port.starts_with('0')
                || !port.bytes().all(|byte| byte.is_ascii_digit())
            {
                return None;
            }
            match port.parse::<u32>() {
                Ok(port) if (1..=65535).contains(&port) => port,
                _ => return None,
            }
        }
    };
    Some((scheme, host.to_ascii_lowercase(), port))
}

/// Checks the location of an outside redirect (HY-132.2 to HY-132.5).
///
/// # Errors
/// `not_outside_location` for a text that is no outside location.
pub fn outside_location(location: &str) -> Result<&str, Error> {
    match outside_parts(location) {
        Some(_) => Ok(location),
        None => Err(Error::NotOutsideLocation),
    }
}

/// The origin of an outside location, `<scheme>://<host>:<port>` with the scheme and the host in lower case and the
/// port of the location or the default port of its scheme, or none for a text that is no outside location (HY-132.13).
#[must_use]
pub fn origin(text: &str) -> Option<String> {
    outside_parts(text).map(|(scheme, host, port)| format!("{scheme}://{host}:{port}"))
}
