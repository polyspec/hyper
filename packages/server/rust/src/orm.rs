//! The errors of the ORM that a handler lets escape (HY-107): the server answers them by their kind.

/// Where the error escaped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Escape {
    /// A loader of a page or the shared handler.
    Loader,
    /// An action.
    Action,
    /// A representation handler (HY-122.12).
    Representation,
}

/// The answer of an escaped error of the ORM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrmAnswer {
    /// The not-found stop (HY-27): 404 with the text `Not Found`.
    NotFound,
    /// The page of the route with status 409 and no data of its own (HY-58, HY-107.9).
    ConflictPage,
    /// 412 with the text `Precondition Failed` (HY-122.12).
    PreconditionFailed,
    /// Not handled: the request fails with HY-43 (HY-107.5).
    Unhandled,
}

/// The answer of an error of the ORM by its kind (HY-107.7 to HY-107.9, HY-122.12).
#[must_use]
pub fn answer(kind: &str, escape: Escape) -> OrmAnswer {
    match (kind, escape) {
        ("no_rows", _) => OrmAnswer::NotFound,
        ("revision_changed", Escape::Action) => OrmAnswer::ConflictPage,
        ("revision_changed", Escape::Representation) => OrmAnswer::PreconditionFailed,
        _ => OrmAnswer::Unhandled,
    }
}
