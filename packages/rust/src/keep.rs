//! The kept values of a region (HY-38): which kept values conform to the region data, the data with them applied, and
//! the `cookie` kept values of the cookie `hy-keep`.

use std::sync::Arc;

use polyspec_json::{parse, Kind, ParseOptions};
use polyspec_template::{bind_json, OrderedMap, Value};

/// The kind of a value of the data model, which a kept value keeps (HY-38.3): a safe string is a string.
#[derive(PartialEq, Eq)]
enum Shape {
    Null,
    Bool,
    Number,
    Text,
    List,
    Map,
    Object,
}

fn shape(value: &Value) -> Shape {
    match value {
        Value::Null => Shape::Null,
        Value::Bool(_) => Shape::Bool,
        Value::Number(_) => Shape::Number,
        Value::Str(_) | Value::Safe(_) => Shape::Text,
        Value::List(_) => Shape::List,
        Value::Map(_) => Shape::Map,
        Value::Object(_) => Shape::Object,
    }
}

/// Whether a kept value conforms to the data value at its path (HY-38.2 to HY-38.6): the same type; a map with the
/// keys of a data map that has keys, each value conforming; a list whose every item conforms to the first item of a
/// data list that has items. An empty data map or list gives no shape.
#[must_use]
pub fn conforms(kept: &Value, data: &Value) -> bool {
    if shape(kept) != shape(data) {
        return false;
    }
    match (kept, data) {
        (Value::Map(kept), Value::Map(data)) => {
            data.is_empty()
                || (kept.len() == data.len()
                    && data.iter().all(|(key, item)| match kept.get(key) {
                        Some(kept_item) => conforms(kept_item, item),
                        None => false,
                    }))
        }
        (Value::List(kept), Value::List(data)) => match data.first() {
            Some(first) => kept.iter().all(|item| conforms(item, first)),
            None => true,
        },
        _ => true,
    }
}

/// The index of a list that a path segment names: decimal digits only (HY-38.2); an index that no `usize` holds names
/// no item.
fn index(segment: &str) -> Option<usize> {
    if segment.is_empty() {
        return None;
    }
    segment.bytes().try_fold(0_usize, |at, byte| {
        let digit = byte.checked_sub(b'0').filter(|digit| *digit <= 9)?;
        at.checked_mul(10)?.checked_add(usize::from(digit))
    })
}

/// The container with the value at the path replaced by the kept value when the path exists and the value conforms,
/// or `None` when nothing changes (HY-38.7, HY-38.19). A map takes a name and a list an index.
fn replace(container: &Value, segments: &[&str], kept: &Value) -> Option<Value> {
    let (first, rest) = segments.split_first()?;
    match container {
        Value::Map(map) => {
            let current = map.get(first)?;
            let replaced = if rest.is_empty() {
                if !conforms(kept, current) {
                    return None;
                }
                kept.clone()
            } else {
                replace(current, rest, kept)?
            };
            let mut copy = (**map).clone();
            copy.insert((*first).to_owned(), replaced);
            Some(Value::Map(Arc::new(copy)))
        }
        Value::List(items) => {
            let at = index(first)?;
            let current = items.get(at)?;
            let replaced = if rest.is_empty() {
                if !conforms(kept, current) {
                    return None;
                }
                kept.clone()
            } else {
                replace(current, rest, kept)?
            };
            let mut copy = (**items).clone();
            *copy.get_mut(at)? = replaced;
            Some(Value::List(Arc::new(copy)))
        }
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::Object(_) => None,
    }
}

/// The kept values that conform to the region data, by path, and the data with them applied (HY-38.8, HY-38.13): each
/// value applies before the next, so a later value of a path conforms to the data after the earlier ones, and the
/// last conforming value of a path counts. A path is the names and indexes of the data joined with `.`.
#[must_use]
pub fn select(data: &Value, kept: &[(String, Value)]) -> (OrderedMap, Value) {
    let mut selected = OrderedMap::new();
    let mut result = data.clone();
    for (path, value) in kept {
        let segments: Vec<&str> = path.split('.').collect();
        if let Some(replaced) = replace(&result, &segments, value) {
            selected.insert(path.clone(), value.clone());
            result = replaced;
        }
    }
    (selected, result)
}

/// The data with the conforming kept values applied (HY-38.13, HY-38.19): every map keeps its keys in their order, and
/// a kept map keeps its own order.
#[must_use]
pub fn apply(data: &Value, kept: &[(String, Value)]) -> Value {
    select(data, kept).1
}

/// The `cookie` kept values of the cookie `hy-keep` (HY-38.10, HY-38.11), whose value is the JSON object
/// `{ "<region>": { "<path>": <value> } }`, by region: a cookie that is no JSON object, a region that holds no object,
/// and a value outside the data model (HY-38.2), such as a number outside ±(2^53 − 1), give no value, because hyper
/// ignores a cookie that it cannot read (HY-42).
#[must_use]
pub fn cookie_values(text: &str) -> Vec<(String, Vec<(String, Value)>)> {
    let Ok(cookie) = parse(text.as_bytes(), &ParseOptions::default()) else {
        return Vec::new();
    };
    if cookie.kind() != Kind::Object {
        return Vec::new();
    }
    let Ok(regions) = cookie.members() else {
        return Vec::new();
    };
    let mut values = Vec::new();
    for (region, paths) in regions.iter() {
        let (Ok(region), Kind::Object) = (region.string_value(), paths.kind()) else {
            continue;
        };
        let Ok(paths) = paths.members() else {
            continue;
        };
        let mut pairs = Vec::new();
        for (path, value) in paths.iter() {
            if let (Ok(path), Ok(value)) = (path.string_value(), bind_json(value)) {
                pairs.push((path, value));
            }
        }
        values.push((region, pairs));
    }
    values
}
