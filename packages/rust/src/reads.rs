//! The read data (HY-73.29, HY-73.22): the server keeps of the shared data and of each region's data only the paths
//! that the templates read. The read paths come from the build (HY-73.23) as a tree whose node is `true` for a path
//! read whole and otherwise holds `keys` and `each` (HY-73.3, HY-73.4).

use std::sync::Arc;

use polyspec_template::{OrderedMap, Value};

use crate::Error;

/// A node of the read paths (HY-73.3, HY-73.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Read {
    /// The path is read whole: its value stays as it is.
    Whole,
    /// The path is read in part: the map keys and list indexes of `keys`, and every entry under `each` (`*`).
    Part {
        keys: Vec<(String, Read)>,
        each: Option<Box<Read>>,
    },
}

impl Read {
    /// Reads a tree of the read paths of the build (HY-73.23).
    ///
    /// # Errors
    /// `invalid_application` for a node that is neither `true` nor a map of `keys` and `each`.
    pub fn from_value(value: &Value) -> Result<Read, Error> {
        match value {
            Value::Bool(true) => Ok(Read::Whole),
            Value::Map(map) => {
                let mut keys = Vec::new();
                let mut each = None;
                for (name, node) in map.iter() {
                    match (name.as_str(), node) {
                        ("keys", Value::Map(children)) => {
                            for (key, child) in children.iter() {
                                keys.push((key.clone(), Read::from_value(child)?));
                            }
                        }
                        ("each", child) => each = Some(Box::new(Read::from_value(child)?)),
                        _ => {
                            return Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                                "a node of the read paths is not allowed (HY-73.23)",
                            )))
                        }
                    }
                }
                Ok(Read::Part { keys, each })
            }
            Value::Null
            | Value::Bool(false)
            | Value::Number(_)
            | Value::Str(_)
            | Value::Safe(_)
            | Value::List(_)
            | Value::Object(_) => Err(Error::InvalidApplication(std::borrow::Cow::Borrowed(
                "a node of the read paths is not allowed (HY-73.23)",
            ))),
        }
    }

    /// The union of two nodes that read one value: a path read whole is read whole (HY-73.4).
    pub(crate) fn union(&self, other: &Read) -> Read {
        match (self, other) {
            (Read::Whole, _) | (_, Read::Whole) => Read::Whole,
            (
                Read::Part {
                    keys: left,
                    each: left_each,
                },
                Read::Part {
                    keys: right,
                    each: right_each,
                },
            ) => {
                let mut keys = left.clone();
                for (key, node) in right {
                    match keys.iter_mut().find(|(name, _)| name == key) {
                        Some((_, existing)) => *existing = existing.union(node),
                        None => keys.push((key.clone(), node.clone())),
                    }
                }
                let each = match (left_each, right_each) {
                    (Some(left), Some(right)) => Some(Box::new(left.union(right))),
                    (Some(one), None) | (None, Some(one)) => Some(one.clone()),
                    (None, None) => None,
                };
                Read::Part { keys, each }
            }
        }
    }

    /// The node of one key or index: the node that names it, joined with the node of every entry.
    fn child(&self, key: &str) -> Option<Read> {
        match self {
            Read::Whole => Some(Read::Whole),
            Read::Part { keys, each } => {
                let named = keys
                    .iter()
                    .find(|(name, _)| name == key)
                    .map(|(_, node)| node);
                match (named, each) {
                    (Some(named), Some(each)) => Some(named.union(each)),
                    (Some(one), None) => Some(one.clone()),
                    (None, Some(each)) => Some((**each).clone()),
                    (None, None) => None,
                }
            }
        }
    }
}

/// Keeps of a value only its read paths (HY-73.29): a map keeps the keys that a path names, in their order in the
/// data, and every key under `each`; a list keeps its length, each element kept by `each` and the node of its index,
/// with null at an index that no path names; any other value stays as it is, and a map that becomes empty stays a map
/// (HY-73.22).
#[must_use]
pub fn keep(value: &Value, read: &Read) -> Value {
    if *read == Read::Whole {
        return value.clone();
    }
    match value {
        Value::Map(map) => {
            let mut kept = OrderedMap::new();
            for (key, child) in map.iter() {
                if let Some(node) = read.child(key) {
                    kept.insert(key.clone(), keep(child, &node));
                }
            }
            Value::Map(Arc::new(kept))
        }
        Value::List(items) => {
            let kept = items
                .iter()
                .enumerate()
                .map(|(index, item)| match read.child(&index.to_string()) {
                    Some(node) => keep(item, &node),
                    None => Value::Null,
                })
                .collect();
            Value::List(Arc::new(kept))
        }
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::Object(_) => value.clone(),
    }
}

impl Read {
    /// The value of a node as the build writes it (HY-73.23, HY-73.32): `true` for a path read whole, and otherwise a
    /// map with `keys`, when a key is read, in the byte order of the keys, and then `each`, when every entry is read.
    #[must_use]
    pub fn to_value(&self) -> Value {
        match self {
            Read::Whole => Value::Bool(true),
            Read::Part { keys, each } => {
                let mut map = OrderedMap::new();
                if !keys.is_empty() {
                    let mut sorted: Vec<&(String, Read)> = keys.iter().collect();
                    sorted.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));
                    let mut named = OrderedMap::with_capacity(keys.len());
                    for (key, node) in sorted {
                        named.insert(key.clone(), node.to_value());
                    }
                    map.insert("keys".to_owned(), Value::Map(Arc::new(named)));
                }
                if let Some(each) = each {
                    map.insert("each".to_owned(), each.to_value());
                }
                Value::Map(Arc::new(map))
            }
        }
    }

    /// The node that reads one path whole (HY-73.4); a step of `None` is `*`, every entry.
    pub(crate) fn path(path: &[Option<String>]) -> Read {
        let mut node = Read::Whole;
        for step in path.iter().rev() {
            node = match step {
                None => Read::Part {
                    keys: Vec::new(),
                    each: Some(Box::new(node)),
                },
                Some(key) => Read::Part {
                    keys: vec![(key.clone(), node)],
                    each: None,
                },
            };
        }
        node
    }

    /// The node that reads one path in part: the entries of a loop (HY-73.14).
    pub(crate) fn part(path: &[Option<String>]) -> Read {
        let mut node = Read::Part {
            keys: Vec::new(),
            each: None,
        };
        for step in path.iter().rev() {
            node = match step {
                None => Read::Part {
                    keys: Vec::new(),
                    each: Some(Box::new(node)),
                },
                Some(key) => Read::Part {
                    keys: vec![(key.clone(), node)],
                    each: None,
                },
            };
        }
        node
    }
}
