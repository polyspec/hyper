//! The readings of a value of the data model that the rules of several modules share.

use std::sync::Arc;

use polyspec_template::{OrderedMap, Value};

/// The map of a value that is a map, or `None` for every other value.
pub(crate) fn map(value: &Value) -> Option<&Arc<OrderedMap>> {
    match value {
        Value::Map(map) => Some(map),
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::List(_)
        | Value::Object(_) => None,
    }
}

/// The texts of a list whose every item is a string, or `None` when an item is another value.
pub(crate) fn texts(items: &[Value]) -> Option<Vec<String>> {
    let mut found = Vec::with_capacity(items.len());
    for item in items {
        match item {
            Value::Str(text) => found.push(text.clone()),
            Value::Null
            | Value::Bool(_)
            | Value::Number(_)
            | Value::Safe(_)
            | Value::List(_)
            | Value::Map(_)
            | Value::Object(_) => return None,
        }
    }
    Some(found)
}
