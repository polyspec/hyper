//! The rules of the hyper server that every runtime shares (C-7), each named by its rule of
//! `contracts/protocol.json`. The libraries that hyper uses keep their own rules: the grammar and the weights of
//! `Accept` (http-negotiate), the media types (http-media-type), the cookies (http-cookies) and the form bodies
//! (http-forms).
//!
//! Every function is pure: no I/O, no clock, no random source and no state between calls (`wait: none`). The caller
//! draws the mask of HY-24.2.

pub mod cookies;
pub mod csrf;
pub mod error;
pub mod etag;
pub mod json;
pub mod location;
pub mod manifest;
pub mod media;
pub mod orm;
pub mod pipeline;
pub mod reply;
pub mod representation;
pub mod router;

pub use error::Error;

/// Checks a redirect stop (HY-50.3): a stop needs a redirect result.
///
/// # Errors
/// `not_redirect_result` for a result that is not a redirect.
pub fn redirect_stop(is_redirect: bool) -> Result<(), Error> {
    if is_redirect {
        Ok(())
    } else {
        Err(Error::NotRedirectResult)
    }
}
