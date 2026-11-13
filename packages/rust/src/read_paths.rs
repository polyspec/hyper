//! The read paths of the templates of an application (HY-73.2 to HY-73.20): what each template reads of its data,
//! computed from the template ASTs before any request, and the read paths of the shared data and of every region of
//! each route, which the build writes to `reads.json` (HY-73.23).

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;

use polyspec_template::{
    resolve_path, BinaryOp, Expr, LiteralValue, LoopMetaField, MapEntry, Node, OrderedMap,
    ParseOptions, Template, Value,
};

use crate::manifest::KeepKind;
use crate::reads::Read;
use crate::steps::Map;
use crate::Error;

/// A path from the root data (HY-73.3): a map key or list index, or `None` for `*`, every entry.
type Path = Vec<Option<String>>;

/// The read paths of every route of the manifest `manifest` with the templates `templates` (HY-73.18, HY-73.19), as
/// the value of the routes of `reads.json`: a map from the name of a route to a map with `shared`, the node of the
/// shared data, and `regions`, the node of each region by name, which `Pages::open` reads.
///
/// # Errors
/// The errors of the manifest check (HY-2.7), a template that does not parse or whose path leaves the root, with the
/// kind of the template language, and `invalid_application` for a template that the manifest or a template names and
/// `templates` does not hold.
pub fn route_reads(manifest: &[u8], templates: &Map<String>) -> Result<Value, Error> {
    let manifest = crate::manifest::read(manifest)?;
    let page = manifest.page()?.to_owned();
    let mut loader = Loader::new(templates);
    let mut cache: HashMap<String, Read> = HashMap::new();
    let mut read = |name: &str, loader: &mut Loader<'_>| -> Result<Read, Error> {
        if let Some(node) = cache.get(name) {
            return Ok(node.clone());
        }
        let node = template_node(loader, name)?;
        cache.insert(name.to_owned(), node.clone());
        Ok(node)
    };
    let mut routes = OrderedMap::with_capacity(manifest.routes.len());
    for route in &manifest.routes {
        let mut named: Vec<(String, Read)> = Vec::new();
        for region in &manifest.regions {
            if let Some(template) = &region.template {
                named.push((region.name.clone(), read(template, &mut loader)?));
            }
        }
        named.push((page.clone(), read(&route.template, &mut loader)?));
        let mut server = false;
        for region in &route.regions {
            let Some(template) = region.template.as_ref().filter(|_| !crate::fault::broken())
            else {
                return Err(Error::Internal("a route region has no template"));
            };
            let mut node = read(template, &mut loader)?;
            for (path, kind) in &region.keep {
                let steps: Path = path.split('.').map(|step| Some(step.to_owned())).collect();
                node = node.union(&Read::path(&steps));
                if *kind == KeepKind::Server {
                    server = true;
                }
            }
            named.push((region.name.clone(), node));
        }
        let mut shared =
            read(&manifest.layout, &mut loader)?.union(&read(&manifest.title, &mut loader)?);
        for (_, node) in &named {
            shared = shared.union(node);
        }
        if server {
            shared = shared.union(&Read::path(&[Some("csrf".to_owned())]));
        }
        let mut regions = OrderedMap::with_capacity(named.len());
        for (name, node) in named {
            regions.insert(name, node.to_value());
        }
        let mut reads = OrderedMap::with_capacity(2);
        reads.insert("shared".to_owned(), shared.to_value());
        reads.insert("regions".to_owned(), Value::Map(Arc::new(regions)));
        routes.insert(route.name.clone(), Value::Map(Arc::new(reads)));
    }
    Ok(Value::Map(Arc::new(routes)))
}

/// The read node of the template `name` among `templates` and of every template that it includes or places by path
/// (HY-73.5 to HY-73.17).
///
/// # Errors
/// The errors of [`route_reads`] for the templates.
pub fn template_reads(templates: &Map<String>, name: &str) -> Result<Value, Error> {
    Ok(template_node(&mut Loader::new(templates), name)?.to_value())
}

fn template_node(loader: &mut Loader<'_>, name: &str) -> Result<Read, Error> {
    let mut reads = Reads {
        root: Read::part(&[]),
        loader,
        failure: None,
    };
    reads.template(name, HashMap::new(), &[])?;
    match reads.failure {
        Some(error) => Err(error),
        None => Ok(reads.root),
    }
}

/// The templates of the application, each parsed once when the computation first reaches it.
struct Loader<'a> {
    templates: &'a Map<String>,
    parsed: HashMap<String, Arc<Template>>,
}

impl<'a> Loader<'a> {
    fn new(templates: &'a Map<String>) -> Self {
        Loader {
            templates,
            parsed: HashMap::new(),
        }
    }

    fn load(&mut self, name: &str) -> Result<Arc<Template>, Error> {
        if let Some(template) = self.parsed.get(name) {
            return Ok(Arc::clone(template));
        }
        let Some(source) = self.templates.get(name) else {
            return Err(Error::InvalidApplication(Cow::Owned(format!(
                "the template {name} is missing (HY-73.2)"
            ))));
        };
        let template =
            match polyspec_template::parse(source.as_bytes(), name, &ParseOptions::default()) {
                Ok(template) => Arc::new(template),
                Err(error) => return Err(Error::Template(error)),
            };
        self.parsed.insert(name.to_owned(), Arc::clone(&template));
        Ok(template)
    }
}

/// The scope of one rendered template file: its local variables with the paths of their assignments, the loop
/// variables that the loops bind while their bodies are read, and the paths of its context names, the scope arguments
/// of a block; other names are root paths (HY-73.6 to HY-73.8, HY-73.16).
struct Scope {
    locals: HashMap<String, Vec<Path>>,
    bound: Vec<(String, Vec<Path>)>,
    context: HashMap<String, Vec<Path>>,
    changed: bool,
}

struct Reads<'l, 'a> {
    root: Read,
    loader: &'l mut Loader<'a>,
    /// A broken invariant that an expression met, which the computation returns when it ends.
    failure: Option<Error>,
}

impl Reads<'_, '_> {
    /// Reads a template in a new scope until its local variables hold every path that an assignment gives them.
    fn template(
        &mut self,
        name: &str,
        context: HashMap<String, Vec<Path>>,
        placing: &[String],
    ) -> Result<(), Error> {
        let mut scope = Scope {
            locals: HashMap::new(),
            bound: Vec::new(),
            context,
            changed: true,
        };
        let mut placed = placing.to_vec();
        placed.push(name.to_owned());
        let template = self.loader.load(name)?;
        while scope.changed {
            scope.changed = false;
            self.statements(
                &template.body,
                name,
                &mut scope,
                &placed,
                &[name.to_owned()],
            )?;
        }
        Ok(())
    }

    fn statements(
        &mut self,
        nodes: &[Node],
        name: &str,
        scope: &mut Scope,
        placing: &[String],
        including: &[String],
    ) -> Result<(), Error> {
        for node in nodes {
            self.statement(node, name, scope, placing, including)?;
        }
        Ok(())
    }

    fn statement(
        &mut self,
        node: &Node,
        name: &str,
        scope: &mut Scope,
        placing: &[String],
        including: &[String],
    ) -> Result<(), Error> {
        match node {
            Node::Echo { expr, .. } => {
                let paths = self.expr(expr, scope);
                self.whole(&paths);
            }
            Node::If {
                branches, r#else, ..
            } => {
                for branch in branches {
                    let paths = self.expr(&branch.test, scope);
                    self.whole(&paths);
                    self.statements(&branch.body, name, scope, placing, including)?;
                }
                if let Some(nodes) = r#else {
                    self.statements(nodes, name, scope, placing, including)?;
                }
            }
            Node::For {
                name: variable,
                iter,
                body,
                empty,
                ..
            } => {
                let each: Vec<Path> = self
                    .expr(iter, scope)
                    .into_iter()
                    .map(|mut path| {
                        path.push(None);
                        path
                    })
                    .collect();
                for path in &each {
                    self.root = self.root.union(&Read::part(path));
                }
                scope.bound.push((variable.clone(), each));
                let read = self.statements(body, name, scope, placing, including);
                scope.bound.pop();
                read?;
                if let Some(nodes) = empty {
                    self.statements(nodes, name, scope, placing, including)?;
                }
            }
            Node::Set {
                name: variable,
                expr,
                ..
            } => {
                let paths = self.expr(expr, scope);
                assign(scope, variable, paths);
            }
            Node::Include { path, .. } => {
                let target = resolve(name, path)?;
                if including.contains(&target) {
                    return Ok(());
                }
                let template = self.loader.load(&target)?;
                let mut deeper = including.to_vec();
                deeper.push(target.clone());
                self.statements(&template.body, &target, scope, placing, &deeper)?;
            }
            Node::Block {
                path, scope: items, ..
            } => {
                let mut arguments = HashMap::new();
                for item in items {
                    let paths = self.expr(&item.expr, scope);
                    arguments.insert(item.name.clone(), paths);
                }
                // HY-73.17: a block that places a definition reads nothing more.
                let Some(path) = path else {
                    return Ok(());
                };
                let target = resolve(name, path)?;
                // HY-73.16: placing a template that is already being placed fails when it renders, so it reads nothing.
                if placing.contains(&target) {
                    return Ok(());
                }
                self.template(&target, arguments, placing)?;
            }
            Node::IfBlock { body, r#else, .. } => {
                self.statements(body, name, scope, placing, including)?;
                if let Some(nodes) = r#else {
                    self.statements(nodes, name, scope, placing, including)?;
                }
            }
            Node::Text { .. } => {}
        }
        Ok(())
    }

    /// The paths of an expression; it reads whole the paths of the values that it uses (HY-73.9, HY-73.11 to HY-73.13,
    /// HY-73.31).
    fn expr(&mut self, expr: &Expr, scope: &Scope) -> Vec<Path> {
        match expr {
            Expr::Var { name, .. } => variable(name, scope),
            Expr::LoopMeta { r#loop, field, .. } => {
                if *field == LoopMetaField::Value {
                    variable(r#loop, scope)
                } else {
                    Vec::new()
                }
            }
            Expr::Member { object, key, .. } => self
                .expr(object, scope)
                .into_iter()
                .map(|mut path| {
                    path.push(Some(key.clone()));
                    path
                })
                .collect(),
            Expr::Index { object, index, .. } => {
                let key = match index.as_ref() {
                    Expr::Literal {
                        value: LiteralValue::String(text),
                        ..
                    } => Some(text.clone()),
                    Expr::Literal {
                        value: LiteralValue::Number(number),
                        ..
                    } => match number_text(*number) {
                        Ok(text) => Some(text),
                        Err(error) => {
                            self.failure = Some(error);
                            None
                        }
                    },
                    _ => None,
                };
                if let Some(key) = key {
                    return self
                        .expr(object, scope)
                        .into_iter()
                        .map(|mut path| {
                            path.push(Some(key.clone()));
                            path
                        })
                        .collect();
                }
                let paths = self.expr(object, scope);
                self.whole(&paths);
                let paths = self.expr(index, scope);
                self.whole(&paths);
                Vec::new()
            }
            Expr::Binary {
                op, left, right, ..
            } => {
                let mut paths = self.expr(left, scope);
                if *op == BinaryOp::Coalesce {
                    paths.extend(self.expr(right, scope));
                    return paths;
                }
                self.whole(&paths);
                let paths = self.expr(right, scope);
                self.whole(&paths);
                Vec::new()
            }
            Expr::Ternary {
                test, then, r#else, ..
            } => {
                let test = self.expr(test, scope);
                self.whole(&test);
                let mut paths = match then {
                    None => test,
                    Some(then) => self.expr(then, scope),
                };
                paths.extend(self.expr(r#else, scope));
                paths
            }
            Expr::Unary { operand, .. } => {
                let paths = self.expr(operand, scope);
                self.whole(&paths);
                Vec::new()
            }
            Expr::Call { args, .. } | Expr::ClassCall { args, .. } => {
                for arg in args {
                    let paths = self.expr(arg, scope);
                    self.whole(&paths);
                }
                Vec::new()
            }
            Expr::MemberCall { object, args, .. } => {
                let paths = self.expr(object, scope);
                self.whole(&paths);
                for arg in args {
                    let paths = self.expr(arg, scope);
                    self.whole(&paths);
                }
                Vec::new()
            }
            Expr::List { items, .. } => {
                for item in items {
                    let inner = match item {
                        Expr::Spread { expr, .. } => expr.as_ref(),
                        item => item,
                    };
                    let paths = self.expr(inner, scope);
                    self.whole(&paths);
                }
                Vec::new()
            }
            Expr::Map { entries, .. } => {
                for entry in entries {
                    match entry {
                        MapEntry::Spread(expr) => {
                            let paths = self.expr(expr, scope);
                            self.whole(&paths);
                        }
                        MapEntry::Entry { key, value } => {
                            let paths = self.expr(key, scope);
                            self.whole(&paths);
                            let paths = self.expr(value, scope);
                            self.whole(&paths);
                        }
                    }
                }
                Vec::new()
            }
            Expr::Literal { .. } | Expr::Spread { .. } => Vec::new(),
        }
    }

    fn whole(&mut self, paths: &[Path]) {
        for path in paths {
            self.root = self.root.union(&Read::path(path));
        }
    }
}

/// The paths of a name (HY-73.6 to HY-73.8): inside the body of a loop that binds it, the paths of the loop source
/// followed by `*` and of its assignments; otherwise the paths of its local variable together with its context paths,
/// or its root path.
fn variable(name: &str, scope: &Scope) -> Vec<Path> {
    let local: &[Path] = match scope.locals.get(name) {
        Some(paths) => paths,
        None => &[],
    };
    if let Some((_, paths)) = scope.bound.iter().rev().find(|(bound, _)| bound == name) {
        let mut all = paths.clone();
        all.extend(local.iter().cloned());
        return all;
    }
    let mut all = local.to_vec();
    match scope.context.get(name) {
        Some(paths) => all.extend(paths.iter().cloned()),
        None => all.push(vec![Some(name.to_owned())]),
    }
    all
}

/// Adds the paths of an assignment to a local variable, and marks the scope changed when one is new (HY-73.6).
fn assign(scope: &mut Scope, name: &str, paths: Vec<Path>) {
    let local = scope.locals.entry(name.to_owned()).or_default();
    for path in paths {
        if !local.contains(&path) {
            local.push(path);
            scope.changed = true;
        }
    }
}

fn resolve(from: &str, path: &str) -> Result<String, Error> {
    match resolve_path(from, path) {
        Ok(target) => Ok(target),
        Err(error) => Err(Error::Template(error)),
    }
}

/// The key of a number literal of an index (HY-73.31): the number text of json, as ECMAScript `Number::toString` writes
/// it (RQ-030 of json), the one float-to-text function of polyspec. A template literal is always finite.
fn number_text(number: f64) -> Result<String, Error> {
    match polyspec_json::number_text(number) {
        Ok(text) if !crate::fault::broken() => Ok(text),
        Ok(_) | Err(_) => Err(Error::Internal(
            "a number literal of a template is not finite",
        )),
    }
}
