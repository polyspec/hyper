//! The manifest (HY-1, HY-2, HY-37, HY-40.2, HY-118): its reading as JSON text of the data model and its check.

use polyspec_template::Value;

use crate::json::{read as read_json, JsonError};
use crate::representation::{entries, entry, Entry};
use crate::router::Router;
use crate::Error;

/// The storage of a kept value (HY-37.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeepKind {
    Server,
    Cookie,
    LocalStorage,
    SessionStorage,
}

impl KeepKind {
    /// The kind of a name as the manifest writes it (HY-37.4).
    #[must_use]
    pub fn of(name: &str) -> Option<KeepKind> {
        match name {
            "server" => Some(KeepKind::Server),
            "cookie" => Some(KeepKind::Cookie),
            "localStorage" => Some(KeepKind::LocalStorage),
            "sessionStorage" => Some(KeepKind::SessionStorage),
            _ => None,
        }
    }

    /// The name of the kind as the manifest writes it.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            KeepKind::Server => "server",
            KeepKind::Cookie => "cookie",
            KeepKind::LocalStorage => "localStorage",
            KeepKind::SessionStorage => "sessionStorage",
        }
    }
}

/// A region of the manifest (HY-2.4) or of a route (HY-30, HY-37).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    pub name: String,
    /// Whether it is the page region, which has no template (HY-2.4).
    pub page: bool,
    pub template: Option<String>,
    pub uses: Vec<String>,
    /// The kept paths with their kinds, in manifest order (HY-37.1).
    pub keep: Vec<(String, KeepKind)>,
}

/// A route of the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub name: String,
    pub path: String,
    pub title: String,
    pub template: String,
    /// Whether the route accepts a `POST` action (HY-2.5).
    pub post: bool,
    pub regions: Vec<Region>,
    pub representations: Vec<Entry>,
}

/// A checked manifest (HY-2.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub layout: String,
    pub title: String,
    pub regions: Vec<Region>,
    pub routes: Vec<Route>,
    pub router: Router,
}

/// The names that no region takes, because the layout places definitions under them (HY-2.3, HY-3.1, HY-125).
const RESERVED: [&str; 4] = ["layout", "title", "data", "build"];

fn invalid(reason: &'static str) -> Error {
    Error::InvalidApplication(reason)
}

fn member<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Map(map) => map.get(key),
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::List(_)
        | Value::Object(_) => None,
    }
}

fn text(value: Option<&Value>) -> Option<&str> {
    match value {
        Some(Value::Str(text)) => Some(text.as_str()),
        Some(_) | None => None,
    }
}

fn list<'a>(value: Option<&'a Value>, reason: &'static str) -> Result<&'a [Value], Error> {
    match value {
        Some(Value::List(items)) => Ok(items.as_slice()),
        Some(_) | None => Err(invalid(reason)),
    }
}

/// Whether a region name matches `[A-Za-z][A-Za-z0-9_-]*` (HY-2.3).
fn is_region_name(name: &str) -> bool {
    match name.as_bytes().split_first() {
        Some((first, rest)) => {
            first.is_ascii_alphabetic()
                && rest
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        }
        None => false,
    }
}

/// Whether a name matches `[A-Za-z_][A-Za-z0-9_]*`, the form of a topic and of a map key of a kept path (HY-37.3).
fn is_identifier(name: &str) -> bool {
    match name.as_bytes().split_first() {
        Some((first, rest)) => {
            (first.is_ascii_alphabetic() || *first == b'_')
                && rest
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        }
        None => false,
    }
}

/// Whether a kept path is a map key followed by `.` and map keys or list indexes (HY-37.3).
fn is_kept_path(path: &str) -> bool {
    let mut steps = path.split('.');
    match steps.next() {
        Some(first) if is_identifier(first) => steps.all(|step| {
            is_identifier(step)
                || (!step.is_empty() && step.bytes().all(|byte| byte.is_ascii_digit()))
        }),
        Some(_) | None => false,
    }
}

/// Checks the name of a region against the names taken so far (HY-2.2, HY-2.3).
fn region_name<'a>(value: &'a Value, taken: &mut Vec<String>) -> Result<&'a str, Error> {
    let Some(name) = text(member(value, "name")) else {
        return Err(invalid("a region name is no text (HY-2.2)"));
    };
    if !is_region_name(name) || RESERVED.contains(&name) || taken.iter().any(|other| other == name)
    {
        return Err(invalid(
            "a region name is not allowed or not unique (HY-2.2, HY-2.3)",
        ));
    }
    taken.push(name.to_owned());
    Ok(name)
}

/// The kept paths of a route region (HY-37.1, HY-37.3, HY-37.4).
fn keep(value: &Value) -> Result<Vec<(String, KeepKind)>, Error> {
    match member(value, "keep") {
        None => Ok(Vec::new()),
        Some(Value::Map(map)) => {
            let mut kept = Vec::with_capacity(map.len());
            for (path, kind) in map.iter() {
                let kind = match text(Some(kind)) {
                    Some(name) => KeepKind::of(name),
                    None => None,
                };
                match kind {
                    Some(kind) if is_kept_path(path) => kept.push((path.clone(), kind)),
                    Some(_) | None => {
                        return Err(invalid(
                            "a kept path or its kind is not allowed (HY-37.3, HY-37.4)",
                        ))
                    }
                }
            }
            Ok(kept)
        }
        Some(_) => Err(invalid("a keep is no map (HY-37.1)")),
    }
}

/// The texts of a list of text (HY-118.7).
fn texts(value: Option<&Value>, reason: &'static str) -> Result<Vec<String>, Error> {
    let mut found = Vec::new();
    for item in list(value, reason)? {
        match item {
            Value::Str(text) => found.push(text.clone()),
            Value::Null
            | Value::Bool(_)
            | Value::Number(_)
            | Value::Safe(_)
            | Value::List(_)
            | Value::Map(_)
            | Value::Object(_) => return Err(invalid(reason)),
        }
    }
    Ok(found)
}

/// The representations of a route (HY-118.2, HY-118.5 to HY-118.7).
fn representations(value: Option<&Value>) -> Result<Vec<Entry>, Error> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let mut checked = Vec::new();
    for item in list(Some(value), "representations is no list (HY-118.1)")? {
        let Some(media_type) = text(member(item, "type")) else {
            return Err(invalid("a representation has no type (HY-118.2)"));
        };
        let parameters = match member(item, "parameters") {
            Some(Value::Map(map)) => {
                let mut parameters = Vec::with_capacity(map.len());
                for (name, values) in map.iter() {
                    parameters.push((
                        name.clone(),
                        texts(Some(values), "a value list is no list of text (HY-118.7)")?,
                    ));
                }
                parameters
            }
            Some(_) | None => return Err(invalid("parameters is no map (HY-118.7)")),
        };
        let methods = texts(
            member(item, "methods"),
            "methods is no list of text (HY-118.7)",
        )?;
        let vary = texts(member(item, "vary"), "vary is no list of text (HY-118.7)")?;
        checked.push(entry(media_type, &parameters, &methods, &vary)?);
    }
    entries(checked)
}

/// Checks a manifest that is a value of the data model (HY-2, HY-37, HY-40.2, HY-118, HY-4.6).
///
/// # Errors
/// `invalid_application` for every rule that the manifest breaks.
pub fn check(manifest: &Value) -> Result<Manifest, Error> {
    let (Some(layout), Some(title)) = (
        text(member(manifest, "layout")),
        text(member(manifest, "title")),
    ) else {
        return Err(invalid(
            "the manifest has no layout or title template (HY-1)",
        ));
    };
    let mut names: Vec<String> = Vec::new();
    let mut regions = Vec::new();
    let mut pages = 0usize;
    for region in list(member(manifest, "regions"), "regions is no list (HY-2.1)")? {
        let name = region_name(region, &mut names)?;
        // HY-37.1: only route regions change in the browser, so only they keep values.
        if member(region, "keep").is_some() {
            return Err(invalid("a manifest region keeps values (HY-37.1)"));
        }
        let mut uses = Vec::new();
        if let Some(topics) = member(region, "uses") {
            for topic in list(Some(topics), "uses is no list (HY-2.4)")? {
                match text(Some(topic)) {
                    Some(topic) if is_identifier(topic) => uses.push(topic.to_owned()),
                    Some(_) | None => return Err(invalid("a topic is not allowed (HY-2.4)")),
                }
            }
        }
        let page = matches!(member(region, "page"), Some(Value::Bool(true)));
        let template = text(member(region, "template")).map(str::to_owned);
        match (page, &template) {
            (true, Some(_)) => return Err(invalid("the page region has a template (HY-2.4)")),
            (false, None) => return Err(invalid("a region has no template (HY-2.4)")),
            (true, None) => pages += 1,
            (false, Some(_)) => {}
        }
        regions.push(Region {
            name: name.to_owned(),
            page,
            template,
            uses,
            keep: Vec::new(),
        });
    }
    if pages != 1 {
        return Err(invalid(
            "the manifest has not exactly one page region (HY-2.4)",
        ));
    }
    let mut route_names: Vec<String> = Vec::new();
    let mut routes = Vec::new();
    for route in list(member(manifest, "routes"), "routes is no list (HY-2.1)")? {
        let Some(name) = text(member(route, "name")) else {
            return Err(invalid("a route name is no text (HY-2.2)"));
        };
        if name.is_empty() || route_names.iter().any(|other| other == name) {
            return Err(invalid("a route name is empty or not unique (HY-2.2)"));
        }
        route_names.push(name.to_owned());
        let (Some(route_title), Some(template), Some(path)) = (
            text(member(route, "title")),
            text(member(route, "template")),
            text(member(route, "path")),
        ) else {
            return Err(invalid("a route has no title, template or path (HY-1)"));
        };
        // HY-40.2: the paths under /_hyper are the server's.
        if path.starts_with("/_hyper") {
            return Err(invalid("a route path starts with /_hyper (HY-40.2)"));
        }
        let post = match member(route, "post") {
            None => false,
            Some(Value::Bool(post)) => *post,
            Some(_) => return Err(invalid("post is no boolean (HY-2.5)")),
        };
        let mut route_regions = Vec::new();
        if let Some(declared) = member(route, "regions") {
            for region in list(Some(declared), "the regions of a route are no list (HY-30)")? {
                let region_name = region_name(region, &mut names)?;
                let kept = keep(region)?;
                let Some(region_template) = text(member(region, "template")) else {
                    return Err(invalid("a route region has no template (HY-30)"));
                };
                route_regions.push(Region {
                    name: region_name.to_owned(),
                    page: false,
                    template: Some(region_template.to_owned()),
                    uses: Vec::new(),
                    keep: kept,
                });
            }
        }
        routes.push(Route {
            name: name.to_owned(),
            path: path.to_owned(),
            title: route_title.to_owned(),
            template: template.to_owned(),
            post,
            regions: route_regions,
            representations: representations(member(route, "representations"))?,
        });
    }
    let paths: Vec<(String, String)> = routes
        .iter()
        .map(|route| (route.name.clone(), route.path.clone()))
        .collect();
    let router = Router::new(&paths)?;
    Ok(Manifest {
        layout: layout.to_owned(),
        title: title.to_owned(),
        regions,
        routes,
        router,
    })
}

/// Reads and checks a manifest file (HY-2.7, HY-2.9): its bytes are JSON text of the data model (HY-54.20).
///
/// # Errors
/// `invalid_application` for a file that is not such a text and for a manifest that the check refuses (HY-106.18).
pub fn read(bytes: &[u8]) -> Result<Manifest, Error> {
    let value = match read_json(bytes) {
        Ok(value) => value,
        Err(JsonError::Malformed(_)) => {
            return Err(invalid("the manifest is no JSON text (HY-2.9)"))
        }
        Err(JsonError::DataModel(_)) => {
            return Err(invalid(
                "the manifest is no value of the data model (HY-2.9)",
            ))
        }
    };
    check(&value)
}

impl Manifest {
    /// The name of the page region (HY-2.4).
    ///
    /// # Errors
    /// `internal`, which a checked manifest does not give.
    pub fn page(&self) -> Result<&str, Error> {
        match self.regions.iter().find(|region| region.page) {
            Some(region) => Ok(&region.name),
            None => Err(Error::Internal(
                "a checked manifest without its page region",
            )),
        }
    }

    /// A region of the manifest or of a route by its name.
    #[must_use]
    pub fn region(&self, name: &str) -> Option<&Region> {
        self.regions
            .iter()
            .chain(self.routes.iter().flat_map(|route| route.regions.iter()))
            .find(|region| region.name == name)
    }
}
