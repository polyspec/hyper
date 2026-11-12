//! The assembly of a page (HY-10, HY-11, HY-17 to HY-19, HY-31, HY-38.8): the shared data, the changed topics, the
//! regions of a response, the kept values that it sends, the JSON value of a response and the embedded data of a
//! document. The rendering of the templates is not here.

use std::sync::Arc;

use polyspec_template::{OrderedMap, Value};

use crate::keep::select;
use crate::manifest::{KeepKind, Manifest, Region};
use crate::Error;

/// The built-in topic that changes when the request path differs from the current path (HY-11.3).
pub const PATH_TOPIC: &str = "path";

/// The shared data (HY-10.2): `title`, `csrf`, then the values that the shared handler returned, which replace a
/// value of the same name in its place.
///
/// # Errors
/// `shared_holds_context` for a shared handler that returned the key `context` (HY-124.8).
pub fn shared_data(
    title: &str,
    csrf: &str,
    returned: Option<&OrderedMap>,
) -> Result<OrderedMap, Error> {
    let mut shared = OrderedMap::new();
    shared.insert("title".to_owned(), Value::text(title));
    shared.insert("csrf".to_owned(), Value::text(csrf));
    if let Some(returned) = returned {
        if returned.contains_key("context") {
            return Err(Error::SharedHoldsContext);
        }
        for (name, value) in returned.iter() {
            shared.insert(name.clone(), value.clone());
        }
    }
    Ok(shared)
}

/// The position of the first of the characters in a text, or its end.
fn end_at(text: &str, stops: &[char]) -> usize {
    match text.find(stops) {
        Some(at) => at,
        None => text.len(),
    }
}

/// The length of the scheme of a URL with its `:` (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`), or 0.
fn scheme_length(url: &str) -> usize {
    let bytes = url.as_bytes();
    match bytes.first() {
        Some(first) if first.is_ascii_alphabetic() => {}
        _ => return 0,
    }
    let name = bytes
        .iter()
        .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
        .count();
    if bytes.get(name) == Some(&b':') {
        name + 1
    } else {
        0
    }
}

/// The current path of a request (HY-11.4): the path of the URL of `HX-Current-URL`, after its scheme and its
/// authority and before its query or fragment, with its bytes read as UTF-8 and its percent-encoded octets as written;
/// `None` without the header, for a URL without a path and for bytes that are not UTF-8.
#[must_use]
pub fn current_path(header: Option<&[u8]>) -> Option<String> {
    let Ok(url) = std::str::from_utf8(header?) else {
        return None;
    };
    let after_scheme = url.get(scheme_length(url)..)?;
    let rest = match after_scheme.strip_prefix("//") {
        Some(authority) => authority.get(end_at(authority, &['/', '?', '#'])..)?,
        // A URL without an authority keeps its scheme in its path, as the reader of the three servers reads it.
        None => url,
    };
    let path = rest.get(..end_at(rest, &['?', '#']))?;
    if path.is_empty() {
        None
    } else {
        Some(path.to_owned())
    }
}

/// A path without its base path (HY-8.2): the path itself for an empty base path, `/` for the base path, the rest
/// after the base path and `/`, and `None` for a path outside the base path.
#[must_use]
pub fn strip_base_path<'a>(path: &'a str, base_path: &str) -> Option<&'a str> {
    if base_path.is_empty() {
        return Some(path);
    }
    if path == base_path {
        return Some("/");
    }
    let rest = path.strip_prefix(base_path)?;
    if rest.starts_with('/') {
        Some(rest)
    } else {
        None
    }
}

/// The changed topics of a request (HY-19.1, HY-11.3): the topics of the previous action in their order, then `path`
/// when the current path, without the base path, differs from the request path; each topic once.
#[must_use]
pub fn changed_topics(
    recorded: &[String],
    current: Option<&str>,
    path: &str,
    base_path: &str,
) -> Vec<String> {
    let mut topics: Vec<String> = Vec::with_capacity(recorded.len() + 1);
    for topic in recorded {
        if !topics.contains(topic) {
            topics.push(topic.clone());
        }
    }
    if let Some(current) = current {
        let current = match strip_base_path(current, base_path) {
            Some(stripped) => stripped,
            None => current,
        };
        if current != path && !topics.iter().any(|topic| topic == PATH_TOPIC) {
            topics.push(PATH_TOPIC.to_owned());
        }
    }
    topics
}

/// The regions of a response (HY-18.1, HY-18.2): every region of the manifest in its order for a document request,
/// and for a region request the page region, then every other region that uses a changed topic, in manifest order.
/// The route regions follow the page region in the data (HY-13.2), and a route region that its loader makes absent is
/// left out by the caller (HY-75).
///
/// # Errors
/// `internal` for a manifest without its page region, which a checked manifest does not give.
pub fn regions<'a>(
    manifest: &'a Manifest,
    document: bool,
    changed: &[String],
) -> Result<Vec<&'a Region>, Error> {
    if document {
        return Ok(manifest.regions.iter().collect());
    }
    let page = manifest.page()?;
    let mut selected: Vec<&Region> = manifest
        .regions
        .iter()
        .filter(|region| region.name == page)
        .collect();
    selected.extend(
        manifest.regions.iter().filter(|region| {
            !region.page && region.uses.iter().any(|topic| changed.contains(topic))
        }),
    );
    Ok(selected)
}

/// The kept values that a response sends (HY-38.8, HY-17): for each region of the data, in its order, the `server`
/// values of the session and the `cookie` values of the cookie at the paths that the manifest declares, in their
/// order, that conform to the region data; a region without such values has no entry.
#[must_use]
pub fn kept_values(
    manifest: &Manifest,
    data: &[(String, Value)],
    server: &[(String, OrderedMap)],
    cookie: &[(String, Vec<(String, Value)>)],
) -> OrderedMap {
    let mut values = OrderedMap::new();
    for (name, region_data) in data {
        let Some(region) = manifest.region(name) else {
            continue;
        };
        let stored = server.iter().find(|(region, _)| region == name);
        let sent = cookie.iter().find(|(region, _)| region == name);
        let mut pairs = Vec::new();
        for (path, kind) in &region.keep {
            let value = match kind {
                KeepKind::Server => stored.and_then(|(_, paths)| paths.get(path)),
                KeepKind::Cookie => sent.and_then(|(_, paths)| {
                    paths
                        .iter()
                        .rev()
                        .find(|(sent_path, _)| sent_path == path)
                        .map(|(_, value)| value)
                }),
                KeepKind::LocalStorage | KeepKind::SessionStorage => None,
            };
            if let Some(value) = value {
                pairs.push((path.clone(), value.clone()));
            }
        }
        let (selected, _) = select(region_data, &pairs);
        if !selected.is_empty() {
            values.insert(name.clone(), Value::Map(Arc::new(selected)));
        }
    }
    values
}

/// The parts of the JSON value of a response (HY-17), in the order of its keys.
pub struct Response<'a> {
    /// The time zone of the server (HY-14.2).
    pub timezone: &'a str,
    /// The name of the route.
    pub route: &'a str,
    /// The parameters of the route, by name.
    pub params: &'a [(String, String)],
    /// The build id (HY-128.1).
    pub build: &'a str,
    /// The member `context` of HY-128.2, or `None` for an application without a context.
    pub context: Option<OrderedMap>,
    /// The shared data after the read paths, without the context (HY-128.3).
    pub shared: OrderedMap,
    /// The data of each region of HY-18 after the read paths, in order.
    pub regions: Vec<(String, Value)>,
    /// The kept values of HY-38.8, by region and path.
    pub kept: OrderedMap,
}

fn map_of(entries: impl IntoIterator<Item = (String, Value)>) -> Value {
    let mut map = OrderedMap::new();
    for (key, value) in entries {
        map.insert(key, value);
    }
    Value::Map(Arc::new(map))
}

/// The JSON value of a response (HY-17.1, HY-17.2, HY-128.1): `env`, `route`, `params`, `build`, `context` for an
/// application with a context, `shared`, `regions` and `kept`.
#[must_use]
pub fn json_value(response: Response<'_>) -> OrderedMap {
    let mut value = OrderedMap::new();
    value.insert(
        "env".to_owned(),
        map_of([("timezone".to_owned(), Value::text(response.timezone))]),
    );
    value.insert("route".to_owned(), Value::text(response.route));
    value.insert(
        "params".to_owned(),
        map_of(
            response
                .params
                .iter()
                .map(|(name, param)| (name.clone(), Value::text(param.as_str()))),
        ),
    );
    value.insert("build".to_owned(), Value::text(response.build));
    if let Some(context) = response.context {
        value.insert("context".to_owned(), Value::Map(Arc::new(context)));
    }
    value.insert("shared".to_owned(), Value::Map(Arc::new(response.shared)));
    value.insert("regions".to_owned(), map_of(response.regions));
    value.insert("kept".to_owned(), Value::Map(Arc::new(response.kept)));
    value
}

/// Whether a document embeds its data (HY-31.3): its reply asks for it and a route region of the route is present.
#[must_use]
pub fn embeds(reply_asks: bool, route_regions: &[String], present: &[(String, Value)]) -> bool {
    reply_asks
        && route_regions
            .iter()
            .any(|name| present.iter().any(|(region, _)| region == name))
}

/// The embedded data of a document (HY-31.2): the JSON value of HY-17 with the member `context` holding its value,
/// `regions` with only the route regions of the route in their order, and `kept` with only the entries of those
/// regions.
#[must_use]
pub fn embedded_data(value: &OrderedMap, route_regions: &[String]) -> OrderedMap {
    let mut embedded = OrderedMap::new();
    for (key, member) in value.iter() {
        let kept = match (key.as_str(), member) {
            ("regions" | "kept", Value::Map(map)) => map_of(
                map.iter()
                    .filter(|(name, _)| route_regions.contains(name))
                    .map(|(name, item)| (name.clone(), item.clone())),
            ),
            _ => member.clone(),
        };
        embedded.insert(key.clone(), kept);
    }
    embedded
}
