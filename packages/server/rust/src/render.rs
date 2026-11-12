//! The rendering of a document (HY-12, HY-13, HY-31, HY-38.12 to HY-38.18) with the template engine of the template
//! language. The engine holds the templates of the application, which the host reads when the application opens, and
//! the functions of the application (HYC-24), which the engine calls while it renders (template FUN-43): a render is
//! one call that the engine does not suspend, so a function of the application is a callback whose exception passes
//! through unchanged (C-0 U-3), and every other handler of the application is a step that the host runs (`step`).

use std::collections::HashMap;
use std::sync::Arc;

use bindgen_core::Failure;
use polyspec_template::{
    bind, merge, AstProgram, BoundMap, DefineInput, Engine, EngineOptions, Env, HostFunction,
    MapLoader, OrderedMap, RenderError, RenderOptions, RenderTarget, TemplateError, Value,
};

use crate::keep::apply;
use crate::manifest::{Manifest, Route};
use crate::Error;

/// The reserved template of the embedded data (HY-31.3).
pub const DATA_TEMPLATE: &str = "hyper/data.tpl";

/// The source of the reserved template of the embedded data (HY-31.3).
pub const DATA_SOURCE: &str =
    "<script type=\"application/json\" id=\"hy-data\">{= json(response) | raw}</script>";

/// The template engine of an application: its templates and its functions.
pub struct Templates {
    engine: Engine,
}

/// A failure of a render: a failure of the template language with its kind, or the exception of a function of the
/// application, unchanged (C-0 U-3).
pub type RenderFailure = Failure<Error>;

fn from_render(failure: RenderError) -> RenderFailure {
    match failure {
        Failure::Kind(error) => Failure::Kind(Error::Template(error)),
        Failure::Raised(raised) => Failure::Raised(raised),
        Failure::Callback(error) => Failure::Callback(error),
    }
}

fn from_template(error: TemplateError) -> RenderFailure {
    Failure::Kind(Error::Template(error))
}

impl Templates {
    /// The engine of the templates of an application, by their names relative to the template root, with the reserved
    /// template of the embedded data (HY-31.3) and the functions of the application (HYC-24.2).
    ///
    /// # Errors
    /// `invalid_application` for a template of the application named `hyper/data.tpl`, which is reserved, and the
    /// error of the template language for a function that it does not register (HYC-24.5).
    pub fn new(
        sources: &[(String, String)],
        functions: HashMap<String, HostFunction>,
    ) -> Result<Templates, Error> {
        let mut loader = MapLoader::new();
        for (name, source) in sources {
            if name == DATA_TEMPLATE {
                return Err(Error::InvalidApplication(
                    "the template hyper/data.tpl is reserved (HY-31.3)",
                ));
            }
            loader.set(name, source);
        }
        loader.set(DATA_TEMPLATE, DATA_SOURCE);
        let program = AstProgram::new(EngineOptions {
            loader: Some(Box::new(loader)),
            functions,
            ..EngineOptions::default()
        })
        .map_err(Error::Template)?;
        Ok(Templates {
            engine: Engine::new(program),
        })
    }

    fn render(
        &self,
        template: &str,
        root: &BoundMap,
        define: HashMap<String, DefineInput>,
        env: &Env,
    ) -> Result<String, RenderFailure> {
        let options = RenderOptions {
            define,
            env: Some(env.clone()),
        };
        self.engine
            .render_bound(RenderTarget::Name(template), root, &options)
            .map_err(from_render)
    }
}

/// The parts of a document that the page gives (HY-12, HY-31, HY-38).
pub struct Document<'a> {
    /// The manifest of the application.
    pub manifest: &'a Manifest,
    /// The route of the request.
    pub route: &'a Route,
    /// The shared data after the read paths, with the context in its place (HY-10, HY-128.4).
    pub shared: &'a OrderedMap,
    /// The data that the loaders gave each region of the document, after the read paths, in the order of HY-18.
    pub regions: &'a [(String, Value)],
    /// The kept values of HY-38.8, by region and path.
    pub kept: &'a OrderedMap,
    /// The environment of the render: the time zone of the server and the current time, which the host gives.
    pub env: Env,
    /// The build id (HY-125.7).
    pub build: &'a str,
    /// The JSON value of the response with the member `context` holding its value, when the document embeds its data
    /// (HY-31.3, HY-128.5), or `None`.
    pub embed: Option<&'a OrderedMap>,
}

/// The regions of a document as the render binds them: each region with its data and its bound map.
struct Parts {
    shared: BoundMap,
    regions: Vec<(String, Value, BoundMap)>,
}

fn bound(value: &Value) -> Result<BoundMap, RenderFailure> {
    match value {
        Value::Map(map) => bind(&**map).map_err(from_template),
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::List(_)
        | Value::Object(_) => Err(Failure::Kind(Error::Internal(
            "the data of a region is not a map (HY-13.1)",
        ))),
    }
}

/// The kept values of a region as pairs of path and value, in their order.
fn pairs_of(kept: &OrderedMap, region: &str) -> Vec<(String, Value)> {
    match kept.get(region) {
        Some(Value::Map(paths)) => paths
            .iter()
            .map(|(path, value)| (path.clone(), value.clone()))
            .collect(),
        Some(_) | None => Vec::new(),
    }
}

/// The names of the route regions of the route that the document holds, in the order of the route (HY-30, HY-75).
fn present_route_regions(route: &Route, parts: &Parts) -> Vec<String> {
    route
        .regions
        .iter()
        .filter(|region| {
            parts
                .regions
                .iter()
                .any(|(name, _, _)| *name == region.name)
        })
        .map(|region| region.name.clone())
        .collect()
}

impl Templates {
    /// The template of a region: the route template for the page region (HY-12.2), the template of a manifest region,
    /// or the template of a route region.
    fn region_template<'m>(
        manifest: &'m Manifest,
        route: &'m Route,
        name: &str,
    ) -> Result<&'m str, RenderFailure> {
        if manifest.page().map_err(Failure::Kind)? == name {
            return Ok(&route.template);
        }
        let region = manifest
            .regions
            .iter()
            .chain(route.regions.iter())
            .find(|region| region.name == name);
        match region.and_then(|region| region.template.as_deref()) {
            Some(template) => Ok(template),
            None => Err(Failure::Kind(Error::Internal(
                "a region of the document has no template",
            ))),
        }
    }

    /// Renders one region alone (HY-13.1, HY-13.2): its template with `merge(shared, region data)`, and for the page
    /// region every present route region rendered alone as an `html` definition.
    fn render_region(
        &self,
        document: &Document<'_>,
        parts: &Parts,
        name: &str,
    ) -> Result<String, RenderFailure> {
        let Some((_, _, data)) = parts.regions.iter().find(|(region, _, _)| region == name) else {
            return Err(Failure::Kind(Error::Internal(
                "a region of the document has no data",
            )));
        };
        let mut define = HashMap::new();
        if document.manifest.page().map_err(Failure::Kind)? == name {
            for region in present_route_regions(document.route, parts) {
                let html = self.render_region(document, parts, &region)?;
                define.insert(
                    region,
                    DefineInput {
                        html: Some(html),
                        ..DefineInput::default()
                    },
                );
            }
        }
        let template = Templates::region_template(document.manifest, document.route, name)?;
        self.render(template, &merge(&parts.shared, data), define, &document.env)
    }

    /// The embedded data (HY-31.2, HY-38.17): the JSON value with the present route regions of the route and their
    /// kept entries, without the kept values of the regions that dropped them.
    fn embedded(
        &self,
        document: &Document<'_>,
        parts: &Parts,
        kept: &OrderedMap,
    ) -> Result<String, RenderFailure> {
        let Some(value) = document.embed else {
            return Ok(String::new());
        };
        let names = present_route_regions(document.route, parts);
        if names.is_empty() {
            return Ok(String::new());
        }
        let embedded = crate::page::embedded_data(value, &names);
        let mut data = OrderedMap::with_capacity(embedded.len());
        for (key, member) in embedded.iter() {
            let member = if key == "kept" {
                let mut entries = OrderedMap::new();
                for (region, paths) in kept.iter() {
                    if names.contains(region) {
                        entries.insert(region.clone(), paths.clone());
                    }
                }
                Value::Map(Arc::new(entries))
            } else {
                member.clone()
            };
            data.insert(key.clone(), member);
        }
        let mut root = OrderedMap::with_capacity(1);
        root.insert("response".to_owned(), Value::Map(Arc::new(data)));
        let root = bind(&root).map_err(from_template)?;
        self.render(DATA_TEMPLATE, &root, HashMap::new(), &document.env)
    }

    /// Renders the layout of a document (HY-12.1): the shared data as root data and the `html` definitions `title`,
    /// `data`, `build` and one per manifest region, each rendered alone.
    fn render_layout(
        &self,
        document: &Document<'_>,
        parts: &Parts,
        kept: &OrderedMap,
    ) -> Result<String, RenderFailure> {
        let html = |text: String| DefineInput {
            html: Some(text),
            ..DefineInput::default()
        };
        let mut define = HashMap::new();
        let title = self.render(
            &document.manifest.title,
            &parts.shared,
            HashMap::new(),
            &document.env,
        )?;
        define.insert("title".to_owned(), html(title));
        define.insert(
            "data".to_owned(),
            html(self.embedded(document, parts, kept)?),
        );
        define.insert(
            "build".to_owned(),
            html(format!(
                "<meta name=\"hyper-build\" content=\"{}\">",
                document.build
            )),
        );
        for region in &document.manifest.regions {
            let rendered = self.render_region(document, parts, &region.name)?;
            define.insert(region.name.clone(), html(rendered));
        }
        self.render(
            &document.manifest.layout,
            &parts.shared,
            define,
            &document.env,
        )
    }

    /// Renders a document (HY-12, HY-13, HY-38.12 to HY-38.18). Each region renders with its kept values applied; when
    /// the document does not render, every region with kept values is rendered alone, the route regions first, then
    /// the other regions and the page region last, and a region that does not render renders with its loader data and
    /// loses its kept values (HY-38.16), also in the embedded data (HY-38.17); a document that does not render then
    /// fails (HY-38.18).
    ///
    /// # Errors
    /// The failure of the template language with its kind, the exception of a function of the application, and
    /// `internal` for a document whose parts break the order of the page.
    pub fn render_document(&self, document: &Document<'_>) -> Result<String, RenderFailure> {
        let shared = bind(document.shared).map_err(from_template)?;
        let mut regions = Vec::with_capacity(document.regions.len());
        for (name, data) in document.regions {
            let applied = apply(data, &pairs_of(document.kept, name));
            let bound_data = bound(&applied)?;
            regions.push((name.clone(), applied, bound_data));
        }
        let mut parts = Parts { shared, regions };
        let mut kept = document.kept.clone();
        let first = self.render_layout(document, &parts, &kept);
        if first.is_ok() || kept.is_empty() {
            return first;
        }
        let page = document.manifest.page().map_err(Failure::Kind)?.to_owned();
        let route_regions = present_route_regions(document.route, &parts);
        let mut order = route_regions.clone();
        order.extend(
            parts
                .regions
                .iter()
                .map(|(name, _, _)| name.clone())
                .filter(|name| *name != page && !route_regions.contains(name)),
        );
        order.push(page);
        for name in order {
            if !kept.contains_key(&name) || self.render_region(document, &parts, &name).is_ok() {
                continue;
            }
            let Some((_, loader)) = document.regions.iter().find(|(region, _)| *region == name)
            else {
                continue;
            };
            let bound_loader = bound(loader)?;
            if let Some(entry) = parts
                .regions
                .iter_mut()
                .find(|(region, _, _)| *region == name)
            {
                *entry = (name.clone(), loader.clone(), bound_loader);
            }
            let mut rest = OrderedMap::with_capacity(kept.len());
            for (region, paths) in kept.iter() {
                if *region != name {
                    rest.insert(region.clone(), paths.clone());
                }
            }
            kept = rest;
        }
        self.render_layout(document, &parts, &kept)
    }
}
