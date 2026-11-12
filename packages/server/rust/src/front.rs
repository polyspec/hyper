//! The steps of a request before its page or its representation (HY-62.9, HY-62.16 to HY-62.23, HY-116, HY-27,
//! HY-127, HY-59.12, HY-120): where a request goes and the plain answers that refuse it. The host calls the selection of
//! client rendering when the application declares it (HY-62.9), because the selection is code of the application, and
//! gives its `chosen` to `route_request`; the host opens the session only for a request that this module sends to a
//! page or to the kept endpoint (HY-120.1).

use crate::client::{refuses_page, shell_answer, ShellAnswer};
use crate::context::valid_header;
use crate::media::{listing, select, Selected, Selection, Served};
use crate::page::strip_base_path;
use crate::steps::{PageKind, Pages};
use crate::Error;

/// The path of the kept endpoint below the base path (HY-40.2).
pub const KEEP_PATH: &str = "/_hyper/keep";

/// What a request needs for its route, which the host read from it.
#[derive(Debug, Clone)]
pub struct Front {
    /// The method, `GET` for a `HEAD` request (HY-27.4).
    pub method: String,
    /// The request path.
    pub path: String,
    /// The field lines of `Accept` (HY-116.17).
    pub accept: Vec<Vec<u8>>,
    /// Whether the request has `HX-Request: true` (HY-15.1).
    pub hx_request: bool,
    /// The value of `Hyper-Context`, or `None` (HY-127).
    pub context_header: Option<Vec<u8>>,
    /// The media type of the body as F-12 of http-form reads it, or `None` without `Content-Type` (HY-59.12).
    pub media_type: Option<String>,
    /// Whether `Content-Type` is no media type, the empty value included (HY-59.12).
    pub malformed_content_type: bool,
}

/// The declarations of the application that the route of a request reads (HY-8, HY-62.2, HY-59.1).
#[derive(Debug, Clone)]
pub struct Declared {
    /// The base path of the application (HY-8).
    pub base_path: String,
    /// The data base path of client rendering, or `None` without the declaration (HY-62.2).
    pub data_base_path: Option<String>,
    /// The form types of the application (HY-59.1).
    pub form_types: Vec<String>,
}

/// A plain text answer that refuses a request (HY-58, HY-65).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plain {
    /// The status.
    pub status: u16,
    /// The text of the body.
    pub body: Vec<u8>,
    /// The `Allow` of a 405 (HY-27.6), or `None`.
    pub allow: Option<String>,
    /// Whether the answer has `Vary: Accept` (HY-117.3).
    pub vary_accept: bool,
}

fn plain(status: u16, body: &str) -> Plain {
    Plain {
        status,
        body: body.as_bytes().to_vec(),
        allow: None,
        vary_accept: false,
    }
}

/// Where a request goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// A plain answer, and no session (HY-120.3).
    Plain { answer: Plain },
    /// The static shell of client rendering (HY-62.34), and no session.
    Shell,
    /// The kept endpoint (HY-40): the host opens the session and checks the request with `keep`.
    Keep,
    /// A representation of a route (HY-118, HY-121), and no session (HY-120.4).
    Representation {
        route: String,
        params: Vec<(String, String)>,
        /// The position of the entry among the representations of the route.
        entry: usize,
        /// The value of each required parameter that the deciding range names (HY-119.5).
        values: Vec<Vec<u8>>,
    },
    /// A page (HY-15): the host opens the session, checks the token of a `POST` (HY-24) and runs the page.
    Page {
        route: String,
        params: Vec<(String, String)>,
        kind: PageKind,
        action: bool,
    },
}

/// A route that refuses the request with a plain answer.
fn refuse(answer: Plain) -> Route {
    Route::Plain { answer }
}

/// The 400 and 415 of the media type of the body of a `POST` (HY-59.12).
fn form_type(front: &Front, declared: &Declared) -> Option<Plain> {
    if front.malformed_content_type {
        return Some(plain(400, "Bad Request"));
    }
    match &front.media_type {
        Some(media_type) if declared.form_types.contains(media_type) => None,
        Some(_) | None => Some(plain(415, "Unsupported Media Type")),
    }
}

/// The route of a request (HY-62.16 to HY-62.23, HY-40, HY-27, HY-116, HY-59.12, HY-127), with the choice of the
/// selection of client rendering, `false` for an application without the declaration (HY-62.14).
///
/// # Errors
/// `internal` for a route of the router that the manifest does not hold.
pub fn route_request(pages: &Pages, chosen: bool, front: &Front) -> Result<Route, Error> {
    let app = pages.application();
    let declared = &app.declared;
    let manifest = &app.manifest;
    let base_path = match (chosen, &declared.data_base_path) {
        (true, Some(data_base_path)) => data_base_path.as_str(),
        (true, None) | (false, _) => declared.base_path.as_str(),
    };
    let method = front.method.as_str();
    let Some(path) = strip_base_path(&front.path, base_path) else {
        if chosen {
            // HY-62.22, HY-62.23, HY-62.34: a chosen request outside the data base path is routed as it is.
            return Ok(
                match shell_answer(manifest, &front.path, method, &front.accept)? {
                    ShellAnswer::NotFound => refuse(plain(404, "Not Found")),
                    ShellAnswer::NotAllowed => refuse(Plain {
                        allow: Some("GET, HEAD".to_owned()),
                        ..plain(405, "Method Not Allowed")
                    }),
                    ShellAnswer::BadRequest => refuse(Plain {
                        vary_accept: true,
                        ..plain(400, "Bad Request")
                    }),
                    ShellAnswer::Listing(body) => refuse(Plain {
                        status: 406,
                        body,
                        allow: None,
                        vary_accept: true,
                    }),
                    ShellAnswer::NotAcceptable => refuse(Plain {
                        vary_accept: true,
                        ..plain(406, "Not Acceptable")
                    }),
                    ShellAnswer::Shell => Route::Shell,
                },
            );
        }
        return Ok(refuse(plain(404, "Not Found")));
    };
    if path == KEEP_PATH {
        if method != "POST" {
            return Ok(refuse(Plain {
                allow: Some("POST".to_owned()),
                ..plain(405, "Method Not Allowed")
            }));
        }
        if let Some(refused) = form_type(front, declared) {
            return Ok(refuse(refused));
        }
        return Ok(Route::Keep);
    }
    let Some(found) = manifest.router.find(path) else {
        return Ok(refuse(plain(404, "Not Found")));
    };
    let Some(route) = manifest
        .routes
        .iter()
        .find(|route| route.name == found.name)
    else {
        return Err(Error::Internal(
            "a route of the router that the manifest does not hold",
        ));
    };
    // HY-116.14, HY-62.20: the page takes part in the selection under the data base path too, so that a request
    // that prefers it receives the 406 of HY-62.20, and only the listing of that path leaves it out.
    let served = Served {
        page: true,
        page_data: true,
    };
    let selected = match select(&front.accept, served, &route.representations) {
        Ok(Selection::Selected(selected)) => selected,
        Ok(Selection::NotAcceptable { body }) => {
            let body = if chosen {
                let data_only = Served {
                    page: false,
                    page_data: true,
                };
                listing(data_only, &route.representations)?
            } else {
                body
            };
            return Ok(refuse(Plain {
                status: 406,
                body,
                allow: None,
                vary_accept: true,
            }));
        }
        Err(Error::Negotiate(_)) => {
            return Ok(refuse(Plain {
                vary_accept: true,
                ..plain(400, "Bad Request")
            }))
        }
        Err(error) => return Err(error),
    };
    if let Selected::Representation { entry, values } = selected {
        return Ok(Route::Representation {
            route: route.name.clone(),
            params: found.params,
            entry,
            values,
        });
    }
    // HY-116.12, HY-27.6: a method other than GET or a declared POST receives 405.
    if method != "GET" && (method != "POST" || !route.post) {
        let allow = if route.post {
            "GET, HEAD, POST"
        } else {
            "GET, HEAD"
        };
        return Ok(refuse(Plain {
            allow: Some(allow.to_owned()),
            ..plain(405, "Method Not Allowed")
        }));
    }
    // HY-62.20: the data base path answers no page.
    if refuses_page(chosen, &selected) {
        return Ok(refuse(Plain {
            vary_accept: true,
            ..plain(406, "Not Acceptable")
        }));
    }
    // HY-127.2: a value of Hyper-Context that is no context hash.
    if app.context && !valid_header(front.context_header.as_deref()) {
        return Ok(refuse(plain(400, "Bad Request")));
    }
    let action = method == "POST";
    if action {
        if let Some(refused) = form_type(front, declared) {
            return Ok(refuse(refused));
        }
    }
    let kind = match (selected, front.hx_request) {
        (Selected::Page, _) => PageKind::Html,
        (_, true) => PageKind::RegionJson,
        (_, false) => PageKind::DocumentJson,
    };
    Ok(Route::Page {
        route: route.name.clone(),
        params: found.params,
        kind,
        action,
    })
}

/// The headers of a page response (HY-15.3, HY-52, HY-53, HY-65, HY-117.1): its `Content-Type`, its `Cache-Control`,
/// which the reply states for a page with status 200 and is `no-store` otherwise, its `Vary` and, for a JSON response
/// with status 200, its weak tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageHeaders {
    /// The status, 304 for a `GET` whose `If-None-Match` equals the tag (HY-53.4).
    pub status: u16,
    /// The headers in order; a 304 has no `Content-Type` and no body.
    pub headers: Vec<(String, String)>,
    /// Whether the response has its body.
    pub body: bool,
}

/// The parts of a page response that decide its headers.
#[derive(Debug, Clone)]
pub struct PageResponse {
    /// The status of the page (HY-69).
    pub status: u16,
    /// Whether the response is JSON (HY-15.3).
    pub json: bool,
    /// The body.
    pub body: String,
    /// The `Cache-Control` that the reply states, or `None` (HY-52).
    pub cache_control: Option<String>,
    /// Whether the application declares a context (HY-117.1).
    pub context: bool,
    /// The masked token of the response (HY-53.1).
    pub masked_token: String,
    /// The token of the session (HY-53.1).
    pub token: String,
    /// The method of the request (HY-53.4).
    pub method: String,
    /// The `If-None-Match` of the request, or `None` (HY-53.4).
    pub if_none_match: Option<String>,
}

/// The headers of a page response (HY-15.3, HY-52, HY-53, HY-65, HY-117.1).
#[must_use]
pub fn page_headers(response: &PageResponse) -> PageHeaders {
    let content_type = if response.json {
        "application/vnd.hyper+json"
    } else {
        "text/html; charset=utf-8"
    };
    let cache_control = match (response.status, &response.cache_control) {
        (200, Some(value)) => value.clone(),
        (_, _) => "no-store".to_owned(),
    };
    let mut headers = vec![
        ("Content-Type".to_owned(), content_type.to_owned()),
        ("Cache-Control".to_owned(), cache_control),
        (
            "Vary".to_owned(),
            crate::media::page_vary(response.context).to_owned(),
        ),
    ];
    if !(response.json && response.status == 200) {
        return PageHeaders {
            status: response.status,
            headers,
            body: true,
        };
    }
    let tag = crate::etag::page_tag(&response.body, &response.masked_token, &response.token);
    headers.push(("ETag".to_owned(), tag.clone()));
    if response.method == "GET"
        && crate::etag::not_modified(response.if_none_match.as_deref(), &tag)
    {
        headers.retain(|(name, _)| name != "Content-Type");
        return PageHeaders {
            status: 304,
            headers,
            body: false,
        };
    }
    PageHeaders {
        status: 200,
        headers,
        body: true,
    }
}

/// The headers that every response of the application carries (HY-45, HY-65.1): the frame policy, and
/// `Cache-Control: no-store` for a status of 400 or more.
#[must_use]
pub fn frame_headers(status: u16, frame_ancestors: &str) -> Vec<(String, String)> {
    let mut headers = vec![(
        "Content-Security-Policy".to_owned(),
        format!("frame-ancestors {frame_ancestors}"),
    )];
    if status >= 400 {
        headers.push(("Cache-Control".to_owned(), "no-store".to_owned()));
    }
    headers
}

/// The value that a request to the kept endpoint stores (HY-40.1): a region that declares the path as `server`, a JSON
/// text of at most 4,096 bytes, and a value of the data model; `None` answers 400. The host checks the token of the
/// form before (HY-24, 403) and the file limit (HY-114, 413).
#[must_use]
pub fn kept_value(
    pages: &Pages,
    region: &str,
    path: &str,
    text: &str,
) -> Option<polyspec_template::Value> {
    let declared = pages
        .application()
        .manifest
        .region(region)?
        .keep
        .iter()
        .any(|(kept, kind)| kept == path && *kind == crate::manifest::KeepKind::Server);
    if !declared || text.len() > 4096 {
        return None;
    }
    // HY-40.1: a text that is no JSON and a value outside the data model both answer 400.
    #[allow(
        clippy::disallowed_methods,
        reason = "HY-40.1: every refusal of the value answers 400"
    )]
    crate::json::read(text.as_bytes()).ok()
}

/// The 406 listing of a page that the data base path does not serve (HY-62.34), for a caller that lists the page.
///
/// # Errors
/// `internal`, which the listing of the page does not give.
pub fn page_listing() -> Result<Vec<u8>, Error> {
    listing(
        Served {
            page: true,
            page_data: false,
        },
        &[],
    )
}
