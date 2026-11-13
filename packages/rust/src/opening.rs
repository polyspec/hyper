//! The session of a request that the route sends to a page or to the kept endpoint (HY-120, HY-24, HY-25.2, HY-40):
//! the host opens the session of the store that its host entry received and gives it to these functions, which read it
//! through the store interface of the session-store library, check the token of a `POST` and give the input of the
//! page. A refused request reads its session only for the token check, after the checks of `front` (HY-120.2).

use polyspec_session_store::Store;
use polyspec_template::Value;

use crate::csrf::{mask, verify};
use crate::front::{kept_value, Plain};
use crate::page::{changed_topics, current_path};
use crate::session::{keep, kept, take_flash, token, SessionFailure};
use crate::steps::{Map, PageInput, PageKind, Pages};
use binding_core::Failure;

/// What the page of a routed request needs besides its session.
#[derive(Debug, Clone)]
pub struct Opening {
    /// The route and its parameters.
    pub route: String,
    pub params: Vec<(String, String)>,
    /// The kind of the request (HY-15).
    pub kind: PageKind,
    /// Whether the request is a `POST`, which runs the action of its route (HY-26).
    pub action: bool,
    /// The request path and the base path that the route removed (HY-8, HY-62.19), which the topic `path` compares
    /// with the current path (HY-11.3).
    pub path: String,
    pub base_path: String,
    /// The mask of the token of this response, 64 lowercase hexadecimal digits that the host draws (HY-24.2, HY-24.3).
    pub mask: String,
    /// The current time of the render, in seconds since the Unix epoch.
    pub now: f64,
    /// The value of `HX-Current-URL`, or `None` (HY-11.4).
    pub current_url: Option<Vec<u8>>,
    /// The value of the cookie `hy-keep`, or `None` (HY-38.10).
    pub keep_cookie: Option<String>,
    /// The value of `Hyper-Context`, or `None` (HY-127).
    pub held_hash: Option<String>,
    /// The last value of the form field `_csrf` of a `POST`, or `None` (HY-24.4).
    pub form_csrf: Option<String>,
}

/// The session of a page.
#[derive(Debug, Clone)]
#[allow(
    clippy::large_enum_variant,
    reason = "one value per request, which the binding converts at once"
)]
pub enum Opened {
    /// The request is refused (HY-59.8): 403 for a `POST` whose form token does not match.
    Refused { answer: Plain },
    /// The page of the request: its input, the flash values that the previous request stored (HY-25.2) and the token
    /// of the session, which the tag of a JSON response uses (HY-53.1).
    Page {
        input: PageInput,
        flash: Map<Value>,
        token: String,
    },
}

fn forbidden() -> Plain {
    Plain {
        status: 403,
        body: b"Forbidden".to_vec(),
        allow: None,
        vary_accept: false,
    }
}

/// Whether the form token of a `POST` matches the token of the session (HY-24.4, HY-24.5): a missing field does not.
fn token_matches(session_token: &str, form_csrf: Option<&str>) -> Result<bool, SessionFailure> {
    match form_csrf {
        Some(value) => verify(session_token, value).map_err(Failure::Kind),
        None => Ok(false),
    }
}

/// Opens the session of a page (HY-120.6, HY-24, HY-59.8): it takes the flash data, then reads the token, which it sets
/// when the session holds none, checks the form token of a `POST`, and reads the kept server values of every region
/// that keeps a value by `server` (HY-40).
///
/// # Errors
/// `invalid_session_token`, `invalid_session_record`, `invalid_csrf_form` for a mask that is not 64 lowercase
/// hexadecimal digits, and a failure of the store.
pub fn open_page(
    pages: &Pages,
    store: &mut dyn Store,
    opening: &Opening,
) -> Result<Opened, SessionFailure> {
    let (values, recorded) = take_flash(store)?;
    let session_token = token(store)?;
    if opening.action && !token_matches(&session_token, opening.form_csrf.as_deref())? {
        return Ok(Opened::Refused {
            answer: forbidden(),
        });
    }
    let csrf = mask(&session_token, &opening.mask).map_err(Failure::Kind)?;
    let current = current_path(opening.current_url.as_deref());
    let changed = changed_topics(
        &recorded,
        current.as_deref(),
        &opening.path,
        &opening.base_path,
    );
    let manifest = &pages.application().manifest;
    let mut stored = Map::new();
    for region in manifest.regions.iter().chain(
        manifest
            .routes
            .iter()
            .flat_map(|route| route.regions.iter()),
    ) {
        let keeps_server = region
            .keep
            .iter()
            .any(|(_, kind)| *kind == crate::manifest::KeepKind::Server);
        if !keeps_server {
            continue;
        }
        let mut paths = Map::new();
        for (path, value) in kept(store, &region.name)?.iter() {
            paths.insert(path.clone(), value.clone());
        }
        stored.insert(region.name.clone(), paths);
    }
    let mut params = Map::new();
    for (name, value) in &opening.params {
        params.insert(name.clone(), value.clone());
    }
    let mut flash = Map::new();
    for (name, value) in values.iter() {
        flash.insert(name.clone(), value.clone());
    }
    Ok(Opened::Page {
        input: PageInput {
            route: opening.route.clone(),
            params,
            kind: opening.kind,
            action: opening.action,
            csrf,
            changed,
            stored,
            keep_cookie: opening.keep_cookie.clone(),
            held_hash: opening.held_hash.clone(),
            now: opening.now,
        },
        flash,
        token: session_token,
    })
}

/// A request to the kept endpoint (HY-40.1): the form fields `_csrf`, `region`, `path` and `value`.
#[derive(Debug, Clone)]
pub struct KeepRequest {
    pub region: String,
    pub path: String,
    pub value: String,
    pub form_csrf: Option<String>,
}

/// Answers a request to the kept endpoint after its route (HY-40.1, HY-59.8): 403 when the form token does not match
/// the token of the session, which the session sets when it holds none, 400 for a value that the region does not keep
/// by `server` or that is no value of the data model, and 204 after the value is stored. The host checks the file limit
/// (HY-114, 413) after the token. The kept endpoint reads only the token and takes no flash data, which belongs to the
/// next page request (HY-120.7).
///
/// # Errors
/// `invalid_session_token`, `invalid_session_record`, the error of the data model and a failure of the store.
pub fn keep_request(
    pages: &Pages,
    store: &mut dyn Store,
    request: &KeepRequest,
) -> Result<Plain, SessionFailure> {
    let session_token = token(store)?;
    if !token_matches(&session_token, request.form_csrf.as_deref())? {
        return Ok(forbidden());
    }
    let Some(value) = kept_value(pages, &request.region, &request.path, &request.value) else {
        return Ok(Plain {
            status: 400,
            body: b"Bad Request".to_vec(),
            allow: None,
            vary_accept: false,
        });
    };
    keep(store, &request.region, &request.path, &value)?;
    Ok(Plain {
        status: 204,
        body: Vec::new(),
        allow: None,
        vary_accept: false,
    })
}
