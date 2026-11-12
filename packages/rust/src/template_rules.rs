//! The template check of an application (HY-48.3, HY-48.13): HC-6, only the layout template carries `hx-*`
//! attributes; HY-3 and HY-125.7, the layout places `{# title}`, `{# data}` and `{# build}` exactly once; HY-3,
//! HY-30 and HY-75, every region is placed once, directly inside an element whose `id` is the region name, without
//! block arguments: a manifest region in the layout, and a route region in the route template or in a template that
//! the route template includes or places by path.

use std::borrow::Cow;
use std::collections::BTreeSet;

use polyspec_template::{resolve_path, Node, ParseOptions, Template};

use crate::manifest::Manifest;
use crate::steps::Map;
use crate::Error;

/// A block placement `{# id}` without a path, with the text node that precedes it in its list of nodes.
struct Placement<'a> {
    id: &'a str,
    arguments: usize,
    before: &'a str,
}

/// The problems of the templates `templates` for the manifest `manifest`, in the order of HY-48.13; none when the
/// templates pass.
///
/// # Errors
/// The errors of the manifest check (HY-2.7), a template that does not parse, with the kind of the template language,
/// and `invalid_application` for a template that the layout, a route or an include names and `templates` does not
/// hold.
pub fn problems(manifest: &[u8], templates: &Map<String>) -> Result<Vec<String>, Error> {
    let manifest = crate::manifest::read(manifest)?;
    let mut problems = Vec::new();
    let names: BTreeSet<&str> = templates.iter().map(|(name, _)| name).collect();
    for name in names {
        if name == manifest.layout || !name.ends_with(".tpl") {
            continue;
        }
        for (index, line) in source(templates, name)?.split('\n').enumerate() {
            if has_hx_attribute(line) {
                problems.push(format!(
                    "{name}:{}: hx- attribute outside the layout (HC-6)",
                    index + 1
                ));
            }
        }
    }
    let layout = parse(templates, &manifest.layout)?;
    let mut placed = Vec::new();
    placements(&layout.body, &mut placed);
    for (id, rule) in [("title", "HY-3"), ("data", "HY-3"), ("build", "HY-125")] {
        let count = placed.iter().filter(|placement| placement.id == id).count();
        if count != 1 {
            problems.push(format!(
                "{}: places {{# {id}}} {count} times, expected once ({rule})",
                manifest.layout
            ));
        }
    }
    let regions: Vec<&str> = manifest
        .regions
        .iter()
        .filter(|region| !region.page)
        .map(|region| region.name.as_str())
        .collect();
    check_regions(&manifest.layout, &regions, &placed, &mut problems);
    check_regions(
        &manifest.layout,
        &[manifest.page()?],
        &placed,
        &mut problems,
    );
    check_routes(&manifest, templates, &mut problems)?;
    Ok(problems)
}

/// Checks the route regions of every route that has some, in manifest order (HY-30, HY-75).
fn check_routes(
    manifest: &Manifest,
    templates: &Map<String>,
    problems: &mut Vec<String>,
) -> Result<(), Error> {
    for route in &manifest.routes {
        if route.regions.is_empty() {
            continue;
        }
        let mut parsed = Vec::new();
        let mut seen = BTreeSet::new();
        graph(templates, &route.template, &mut seen, &mut parsed)?;
        let mut placed = Vec::new();
        for template in &parsed {
            placements(&template.body, &mut placed);
        }
        let names: Vec<&str> = route
            .regions
            .iter()
            .map(|region| region.name.as_str())
            .collect();
        check_regions(&route.template, &names, &placed, problems);
    }
    Ok(())
}

/// Parses a template and every template that it includes or places by path, each once, in the order in which the
/// check visits them.
fn graph(
    templates: &Map<String>,
    name: &str,
    seen: &mut BTreeSet<String>,
    parsed: &mut Vec<Template>,
) -> Result<(), Error> {
    if !seen.insert(name.to_owned()) {
        return Ok(());
    }
    let template = parse(templates, name)?;
    let mut targets = Vec::new();
    paths(&template.body, &mut targets);
    parsed.push(template);
    for target in targets {
        let resolved = match resolve_path(name, &target) {
            Ok(resolved) => resolved,
            Err(error) => return Err(Error::Template(error)),
        };
        graph(templates, &resolved, seen, parsed)?;
    }
    Ok(())
}

/// The paths of the includes and of the blocks with a path of a list of nodes and of every list inside it.
fn paths(nodes: &[Node], found: &mut Vec<String>) {
    for node in nodes {
        match node {
            Node::Include { path, .. }
            | Node::Block {
                path: Some(path), ..
            } => found.push(path.clone()),
            Node::Block { path: None, .. }
            | Node::Text { .. }
            | Node::Echo { .. }
            | Node::Set { .. } => {}
            node => {
                for list in children(node) {
                    paths(list, found);
                }
            }
        }
    }
}

/// The block placements without a path of a list of nodes and of every list inside it.
fn placements<'a>(nodes: &'a [Node], found: &mut Vec<Placement<'a>>) {
    for (index, node) in nodes.iter().enumerate() {
        if let Node::Block {
            id: Some(id),
            path: None,
            scope,
            ..
        } = node
        {
            let before = match index
                .checked_sub(1)
                .and_then(|previous| nodes.get(previous))
            {
                Some(Node::Text { value, .. }) => value.as_str(),
                _ => "",
            };
            found.push(Placement {
                id,
                arguments: scope.len(),
                before,
            });
        }
        for list in children(node) {
            placements(list, found);
        }
    }
}

/// The lists of nodes directly inside a node: the branches of a condition, the body and the empty branch of a loop
/// and the bodies of an if-block.
fn children(node: &Node) -> Vec<&[Node]> {
    match node {
        Node::If {
            branches, r#else, ..
        } => {
            let mut lists: Vec<&[Node]> = branches
                .iter()
                .map(|branch| branch.body.as_slice())
                .collect();
            lists.extend(r#else.as_deref());
            lists
        }
        Node::For { body, empty, .. } => {
            let mut lists = vec![body.as_slice()];
            lists.extend(empty.as_deref());
            lists
        }
        Node::IfBlock { body, r#else, .. } => {
            let mut lists = vec![body.as_slice()];
            lists.extend(r#else.as_deref());
            lists
        }
        Node::Text { .. }
        | Node::Echo { .. }
        | Node::Set { .. }
        | Node::Include { .. }
        | Node::Block { .. } => Vec::new(),
    }
}

/// Checks that each region of `regions` is placed once among `placed`, directly inside an element whose `id` is its
/// name and without block arguments (HY-3, HY-30).
fn check_regions(
    template: &str,
    regions: &[&str],
    placed: &[Placement<'_>],
    problems: &mut Vec<String>,
) {
    for region in regions {
        let places: Vec<&Placement<'_>> = placed
            .iter()
            .filter(|placement| placement.id == *region)
            .collect();
        let [placement] = places.as_slice() else {
            problems.push(format!(
                "{template}: places {{# {region}}} {} times, expected once (HY-3, HY-30)",
                places.len()
            ));
            continue;
        };
        if !inside_element(placement.before, region) {
            problems.push(format!(
                "{template}: {{# {region}}} is not directly inside an element with id=\"{region}\" (HY-3, HY-30)"
            ));
        }
        if placement.arguments > 0 {
            problems.push(format!(
                "{template}: {{# {region}}} has block arguments (HY-3, HY-30)"
            ));
        }
    }
}

/// Whether the text before a placement ends with the start tag of an element whose attribute `id` is the region name:
/// a lowercase element name, then white space and `id="<region>"` among its attributes, and nothing after the tag.
fn inside_element(before: &str, region: &str) -> bool {
    let Some(tag) = before.strip_suffix('>') else {
        return false;
    };
    let Some(start) = tag.rfind('<') else {
        return false;
    };
    let Some(inner) = tag.get(start + 1..) else {
        return false;
    };
    if inner.contains('>') {
        return false;
    }
    let mut chars = inner.char_indices();
    if !matches!(chars.next(), Some((_, 'a'..='z'))) {
        return false;
    }
    // The element name runs to the first character that it cannot hold, or to the end of the tag.
    let name_end = match inner
        .char_indices()
        .skip(1)
        .find(|(_, ch)| !matches!(ch, 'a'..='z' | '0'..='9' | '-'))
    {
        Some((index, _)) => index,
        None => inner.len(),
    };
    let Some(rest) = inner.get(name_end..) else {
        return false;
    };
    let attribute = format!("id=\"{region}\"");
    rest.chars().next().is_some_and(is_space)
        && rest.char_indices().any(|(index, ch)| {
            is_space(ch)
                && rest
                    .get(index + ch.len_utf8()..)
                    .is_some_and(|after| after.starts_with(&attribute))
        })
}

/// Whether a line holds white space followed by `hx-` and a letter, in any case (HC-6).
fn has_hx_attribute(line: &str) -> bool {
    line.char_indices().any(|(index, ch)| {
        is_space(ch)
            && line.get(index + ch.len_utf8()..).is_some_and(|after| {
                let mut rest = after.chars();
                matches!(
                    (rest.next(), rest.next(), rest.next(), rest.next()),
                    (Some('h' | 'H'), Some('x' | 'X'), Some('-'), Some(letter)) if letter.is_ascii_alphabetic()
                )
            })
    })
}

/// White space as the class `\s` of an ECMAScript regular expression: the white space and line terminators of
/// ECMA-262, sections 12.2 and 12.3.
fn is_space(ch: char) -> bool {
    matches!(
        ch,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn source<'a>(templates: &'a Map<String>, name: &str) -> Result<&'a str, Error> {
    match templates.get(name) {
        Some(source) => Ok(source),
        None => Err(Error::InvalidApplication(Cow::Owned(format!(
            "the template {name} is missing (HY-48.3)"
        )))),
    }
}

fn parse(templates: &Map<String>, name: &str) -> Result<Template, Error> {
    match polyspec_template::parse(
        source(templates, name)?.as_bytes(),
        name,
        &ParseOptions::default(),
    ) {
        Ok(template) => Ok(template),
        Err(error) => Err(Error::Template(error)),
    }
}
