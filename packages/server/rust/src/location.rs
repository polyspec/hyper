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
