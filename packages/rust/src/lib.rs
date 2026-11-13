//! The rules of the hyper server that every runtime shares (C-7), each named by its rule of
//! `contracts/protocol.json`. The libraries that hyper uses keep their own rules: the grammar and the weights of
//! `Accept` (http-negotiation), the media types (http-media-type), the cookies (http-cookie) and the form bodies
//! (http-form).
//!
//! Every function is pure: no I/O, no clock, no random source and no state between calls (`wait: none`). The caller
//! draws the mask of HY-24.2.

pub mod build;
pub mod client_rendering;
pub mod context;
pub mod cookies;
pub mod csrf;
pub mod error;
pub mod etag;
pub mod front;
pub mod json;
pub mod keep;
pub mod location;
pub mod manifest;
pub mod media;
pub mod opening;
pub mod orm;
pub mod page;
pub mod pipeline;
pub mod read_paths;
pub mod reads;
pub mod render;
pub mod reply;
pub mod representation;
pub mod router;
pub mod session;
pub mod steps;
pub mod template_rules;
mod values;

pub use error::Error;

/// The fault injection points of the core (binding design G-5, X-1; HY-132), which the interface contract names in
/// `faults`. A point does nothing unless the feature `fault-test` of this crate is on: the macro `point!` of binding_core
/// judges the feature of the crate that writes the point, so the feature of another core does not turn it on.
pub mod fault {
    /// Each invariant of the core whose failure is the kind `internal` and that no input reaches, treated as broken at
    /// the place that checks it: the condition that the place reads holds, and the point makes it fail as when it does
    /// not.
    #[doc(hidden)]
    pub const INTERNAL: &str = "hyper.internal";

    /// Whether the point `hyper.internal` breaks the invariant that its caller checks here. Each call is a visit of
    /// the point.
    pub(crate) fn broken() -> bool {
        binding_core::fault::point!(INTERNAL).is_some()
    }
}

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
