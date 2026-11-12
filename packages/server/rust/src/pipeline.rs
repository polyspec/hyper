//! The order of the steps of a request (HY-59.3, HY-116.1, HY-120, HY-131.18): which check answers first, and which
//! request opens a session.

use crate::media::Selected;

/// A step of the answer of a request, in the order in which the server takes them; a step that answers ends the
/// request, and no later step runs (HY-59.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Step {
    /// A `Content-Length` that is no number (400) or larger than the body limit (413), before the body is read
    /// (HY-131.29, HY-131.18).
    DeclaredLength,
    /// The limits of the body and the failures of HY-42 while the body is read (HY-131.18).
    Body,
    /// The selection of HY-62 and the removal of the data base path (HY-62.19).
    ClientRendering,
    /// The routing of the path (HY-27, 404).
    Route,
    /// The selection of the media type (HY-116.1): its 400 and 406.
    MediaType,
    /// The method against the selected type (HY-116.12, HY-27, HY-121.6).
    Method,
    /// The context hash (HY-127).
    Context,
    /// The form type of a `POST` (HY-59.12): its 400 and 415, and the file limit (HY-114).
    FormType,
    /// The opening of the session (HY-120.2).
    OpenSession,
    /// The token check of HY-24 (403).
    Token,
    /// The handlers.
    Handlers,
}

/// The steps in order (HY-120.2): every check that refuses a request comes before the session opens, so a refused
/// request waits for no lock (HY-120.3).
pub const ORDER: [Step; 11] = [
    Step::DeclaredLength,
    Step::Body,
    Step::ClientRendering,
    Step::Route,
    Step::MediaType,
    Step::Method,
    Step::Context,
    Step::FormType,
    Step::OpenSession,
    Step::Token,
    Step::Handlers,
];

/// Whether a request opens a session (HY-120.1, HY-120.4): `<base path>/_hyper/keep` and a request that selects
/// `text/html` or `application/vnd.hyper+json`; a representation request opens none.
#[must_use]
pub fn opens_session(keep_endpoint: bool, selected: Option<&Selected>) -> bool {
    keep_endpoint || matches!(selected, Some(Selected::Page | Selected::PageData))
}
