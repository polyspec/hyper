//! Client rendering (HY-62): the checks of its declaration when the application opens, the place of a chosen request,
//! and the answers that a chosen request receives outside the data base path. The host reads the shell file and calls
//! the selection of the application, which is code of the application, and gives the core their results.

use crate::manifest::Manifest;
use crate::media::{select, Selected, Selection, Served};
use crate::Error;

/// The failure of a declaration of client rendering, with its cause (HY-62.37, HY-62.39).
fn invalid(cause: String) -> Error {
    Error::InvalidApplication(std::borrow::Cow::Owned(cause + " (HY-62)"))
}

/// Checks the path of the shell file before the host reads it (HY-62.35).
///
/// # Errors
/// `invalid_application` for a path that is not absolute, naming the shell with its path (HY-62.37).
pub fn check_shell_path(path: &str) -> Result<(), Error> {
    if path.starts_with('/') {
        Ok(())
    } else {
        Err(invalid(format!(
            "static shell {path} is not an absolute path"
        )))
    }
}

/// The failure of a shell file that does not exist or that the host cannot read (HY-62.35, HY-62.37).
#[must_use]
pub fn unreadable_shell(path: &str) -> Error {
    invalid(format!(
        "static shell {path} does not exist or cannot be read"
    ))
}

/// The text of the shell file: its bytes as UTF-8 (HY-62.35).
///
/// # Errors
/// `invalid_application` for bytes that are not UTF-8, naming the shell with its path (HY-62.37).
pub fn shell_text(path: &str, bytes: Vec<u8>) -> Result<String, Error> {
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(_not_utf8) => Err(invalid(format!("static shell {path} is not valid UTF-8"))),
    }
}

/// A data base path as the attribute of `hyper-api` writes it: `&`, `"`, `'`, `<` and `>` escaped as PHP
/// `htmlspecialchars` with `ENT_QUOTES` escapes them (HYC-8).
fn attribute(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#039;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Checks a declaration of client rendering (HY-62.5, HY-62.6, HY-62.15, HY-62.3): the data base path follows HY-8
/// and is not empty, no route path is the data base path or lies under it, and the shell declares it.
///
/// # Errors
/// `invalid_application` naming its cause: the data base path, the route under it, or the shell with its path
/// (HY-62.37).
pub fn check_declaration(
    manifest: &Manifest,
    base_path: &str,
    shell_path: &str,
    shell: &str,
) -> Result<(), Error> {
    if base_path.is_empty() || !base_path.starts_with('/') || base_path.ends_with('/') {
        return Err(invalid(format!(
            "data base path {base_path} must start with / and must not end with /"
        )));
    }
    for route in &manifest.routes {
        let under = route
            .path
            .strip_prefix(base_path)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
        if under {
            return Err(invalid(format!(
                "route {} lies under the data base path {base_path}",
                route.name
            )));
        }
    }
    let meta = format!(
        "<meta name=\"hyper-api\" content=\"{}\">",
        attribute(base_path)
    );
    if shell.contains(&meta) {
        Ok(())
    } else {
        Err(invalid(format!(
            "static shell {shell_path} does not declare the data base path {base_path}"
        )))
    }
}

/// The answer of a chosen request outside the data base path (HY-62.22, HY-62.23, HY-62.34).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellAnswer {
    /// A path without a route: 404.
    NotFound,
    /// A method other than `GET` or `HEAD`: 405 with `Allow: GET, HEAD`.
    NotAllowed,
    /// An `Accept` that does not follow its grammar: 400 with `Vary: Accept` (HY-116.18).
    BadRequest,
    /// No type is acceptable: 406 with this listing of `text/html` and `Vary: Accept` (HY-116.13).
    Listing(Vec<u8>),
    /// A request that selects `application/vnd.hyper+json` or a representation: 406 with `Not Acceptable`.
    NotAcceptable,
    /// A request that selects `text/html`: 200 with the bytes of the shell.
    Shell,
}

/// The answer of a chosen request whose path lies outside the data base path (HY-62.22, HY-62.23, HY-62.34): the path
/// is routed as it is and the method checked before the media type is selected among the page, the page data and the
/// representations of the route, which are not listed (HY-116.14). A `HEAD` request is answered as its `GET`.
///
/// # Errors
/// `internal` for a route that the manifest does not hold.
pub fn shell_answer(
    manifest: &Manifest,
    path: &str,
    method: &str,
    accept_lines: &[Vec<u8>],
) -> Result<ShellAnswer, Error> {
    let Some(found) = manifest.router.find(path) else {
        return Ok(ShellAnswer::NotFound);
    };
    if method != "GET" && method != "HEAD" {
        return Ok(ShellAnswer::NotAllowed);
    }
    let route = manifest.routed(&found.name)?;
    let served = Served {
        page: true,
        page_data: true,
    };
    match select(accept_lines, served, &route.representations) {
        Ok(Selection::Selected(Selected::Page)) => Ok(ShellAnswer::Shell),
        Ok(Selection::Selected(Selected::PageData | Selected::Representation { .. })) => {
            Ok(ShellAnswer::NotAcceptable)
        }
        Ok(Selection::NotAcceptable { .. }) => {
            let page_only = Served {
                page: true,
                page_data: false,
            };
            Ok(ShellAnswer::Listing(crate::media::listing(page_only, &[])?))
        }
        Err(Error::Negotiate(_)) => Ok(ShellAnswer::BadRequest),
        Err(error) => Err(error),
    }
}

/// Whether a chosen request under the data base path that selects `text/html` is refused with 406 after the method
/// check (HY-62.20), because the data base path answers no page.
#[must_use]
pub fn refuses_page(chosen: bool, selected: &Selected) -> bool {
    chosen && *selected == Selected::Page
}
