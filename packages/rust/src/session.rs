//! The values that hyper keeps in a session (HY-104.25): the token (HY-24), the flash values and the changed topics
//! (HY-25), the kept server values (HY-40) under the keys of HY-104.22, and the conversion between the record of the
//! session-store library, a PHP value, and the data model (HY-104.13, HY-104.14). The storage is the session-store library's;
//! hyper reads and writes through its store interface (SE-2).

use std::sync::Arc;

use binding_core::Failure;
use polyspec_php_serialization::{Key, Node, PhpValue};
use polyspec_session_store::Store;
use polyspec_template::{BindError, ErrorCode, OrderedMap, Value};

use crate::csrf::stored_token;
use crate::{values, Error};

/// The key of the token (HY-104.22).
pub const TOKEN_KEY: &str = "_hyper_csrf";
/// The key of the flash values and the changed topics (HY-104.22).
pub const FLASH_KEY: &str = "_hyper_flash";
/// The key of the kept values (HY-104.22).
pub const KEEP_KEY: &str = "_hyper_keep";

/// The depth of the data model (VAL-20).
const MAX_DEPTH: usize = 64;

/// The largest integer of the data model, 2^53 − 1 (VAL-2).
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// A failure of a session operation: a kind, or the exception of a store of another language, which goes back
/// unchanged (SE-3.2, binding design E-1c).
pub type SessionFailure = Failure<Error>;

fn data(code: ErrorCode, message: &str) -> Error {
    Error::DataModel(BindError {
        code,
        message: message.to_owned(),
    })
}

fn from_store<T>(result: Result<T, polyspec_session_store::Failure>) -> Result<T, SessionFailure> {
    match result {
        Ok(value) => Ok(value),
        Err(Failure::Kind(error)) => Err(Failure::Kind(Error::Sessions(error))),
        Err(Failure::Raised(raised)) => Err(Failure::Raised(raised)),
        Err(Failure::Callback(error)) => Err(Failure::Callback(error)),
    }
}

fn kind<T>(result: Result<T, Error>) -> Result<T, SessionFailure> {
    result.map_err(Failure::Kind)
}

/// A number of a record as a number of the data model (VAL-2, VAL-3).
fn number(value: f64) -> Result<Value, Error> {
    if !value.is_finite() {
        return Err(data(
            ErrorCode::E_DATA_NUMBER_NOT_FINITE,
            "a number of the session record is not finite",
        ));
    }
    if value.abs() > MAX_SAFE {
        return Err(data(
            ErrorCode::E_DATA_NUMBER_RANGE,
            "a number of the session record is outside the data model",
        ));
    }
    Ok(Value::Number(value))
}

/// The number of an integer of the data model, within ±(2^53 − 1), converted exactly through its two 32-bit halves;
/// none outside it (VAL-2).
fn integer(value: i64) -> Option<f64> {
    const LIMIT: i64 = 9_007_199_254_740_991;
    if !(-LIMIT..=LIMIT).contains(&value) {
        return None;
    }
    let magnitude = value.unsigned_abs();
    let (Ok(high), Ok(low)) = (
        u32::try_from(magnitude >> 32),
        u32::try_from(magnitude & 0xffff_ffff),
    ) else {
        return None;
    };
    let number = f64::from(high) * 4_294_967_296.0 + f64::from(low);
    Some(if value < 0 { -number } else { number })
}

/// Reads a node of a record as a value of the data model (HY-104.13): an integer key is its decimal text, a float is
/// its number, a `stdClass` is a map, a reference is its value, and an array whose keys are 0 to n-1 in order is a
/// list.
fn read_node(record: &PhpValue, node: &Node, depth: usize) -> Result<Value, Error> {
    match node {
        Node::Null => Ok(Value::Null),
        Node::Bool(value) => Ok(Value::Bool(*value)),
        Node::Int(value) => match integer(*value) {
            Some(number) => Ok(Value::Number(number)),
            None => Err(data(
                ErrorCode::E_DATA_NUMBER_RANGE,
                "an integer of the session record is outside the data model",
            )),
        },
        Node::Float(value) => number(*value),
        Node::String(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(text) => Ok(Value::Str(text)),
            Err(_) => Err(data(
                ErrorCode::E_DATA_INVALID_UTF8,
                "a string of the session record is not UTF-8 text",
            )),
        },
        Node::Reference(id) => {
            let target = record.reference(*id).map_err(Error::RecordValue)?;
            read_node(record, target, depth)
        }
        Node::Array(_) | Node::Object(_) if depth >= MAX_DEPTH => Err(data(
            ErrorCode::E_DATA_DEPTH,
            "the session record nests deeper than the data model",
        )),
        Node::Array(id) => {
            let array = record.array(*id).map_err(Error::RecordValue)?;
            let mut sequence = true;
            for (index, (key, _)) in array.iter().enumerate() {
                let expected = match i64::try_from(index) {
                    Ok(expected) if !crate::fault::broken() => expected,
                    Ok(_) | Err(_) => {
                        return Err(Error::Internal("an array of more entries than i64"))
                    }
                };
                if *key != Key::Int(expected) {
                    sequence = false;
                    break;
                }
            }
            if sequence {
                let items = array
                    .iter()
                    .map(|(_, child)| read_node(record, child, depth + 1))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Value::List(Arc::new(items)))
            } else {
                let mut map = OrderedMap::with_capacity(array.len());
                for (key, child) in array.iter() {
                    let name = match key {
                        Key::Int(number) => number.to_string(),
                        Key::String(bytes) => match String::from_utf8(bytes.clone()) {
                            Ok(text) => text,
                            Err(_) => {
                                return Err(data(
                                    ErrorCode::E_DATA_INVALID_UTF8,
                                    "a key of the session record is not UTF-8 text",
                                ))
                            }
                        },
                    };
                    map.insert(name, read_node(record, child, depth + 1)?);
                }
                Ok(Value::Map(Arc::new(map)))
            }
        }
        Node::Object(id) => {
            let object = record.object(*id).map_err(Error::RecordValue)?;
            let mut map = OrderedMap::with_capacity(object.len());
            for (name, child) in object.iter() {
                let Ok(text) = String::from_utf8(name.to_vec()) else {
                    return Err(data(
                        ErrorCode::E_DATA_INVALID_UTF8,
                        "a property of the session record is not UTF-8 text",
                    ));
                };
                map.insert(text, read_node(record, child, depth + 1)?);
            }
            Ok(Value::Map(Arc::new(map)))
        }
    }
}

/// The node of a number of the data model: an integer as a PHP integer and another number as a float (HY-104.14).
fn number_node(value: f64) -> Result<Node, Error> {
    if !value.is_finite() || crate::fault::broken() {
        return Err(Error::Internal(
            "a number of the data model that is not finite",
        ));
    }
    match exact_integer(value) {
        Some(integer) => Ok(Node::Int(integer)),
        None => Ok(Node::Float(value)),
    }
}

/// The integer that a float equals exactly, when it is integral and within ±(2^53 − 1), read from the bits of the float
/// without a rounding conversion (HY-104.14): the significand with its implicit bit, shifted by the exponent, with no
/// bit lost by the shift.
fn exact_integer(value: f64) -> Option<i64> {
    const LIMIT: i64 = 9_007_199_254_740_991;
    if value == 0.0 {
        return Some(0);
    }
    let bits = value.to_bits();
    let negative = bits >> 63 == 1;
    let biased = (bits >> 52) & 0x7ff;
    let fraction = bits & 0x000f_ffff_ffff_ffff;
    // Subnormal numbers, infinities and NaN are no integers of the data model.
    if biased == 0 || biased == 0x7ff {
        return None;
    }
    let significand = fraction | 0x0010_0000_0000_0000;
    // The value is significand × 2^(biased − 1075).
    let magnitude = if biased >= 1075 {
        let Ok(shift) = u32::try_from(biased - 1075) else {
            return None;
        };
        significand
            .checked_shl(shift)
            .filter(|shifted| shifted >> shift == significand)?
    } else {
        let Ok(shift) = u32::try_from(1075 - biased) else {
            return None;
        };
        if shift >= 64 || significand & ((1_u64 << shift) - 1) != 0 {
            return None;
        }
        significand >> shift
    };
    let Ok(magnitude) = i64::try_from(magnitude) else {
        return None;
    };
    if magnitude > LIMIT {
        return None;
    }
    Some(if negative { -magnitude } else { magnitude })
}

/// Whether the keys of a map are `0` to `n-1` in order, which PHP would read back as a list (HY-104.14).
fn has_list_keys(map: &OrderedMap) -> bool {
    map.keys()
        .enumerate()
        .all(|(index, key)| *key == index.to_string())
}

/// Writes a value of the data model into a record and gives its node (HY-104.14): a list is an array with the keys 0
/// to n-1, an empty map and a map whose keys are `0` to `n-1` are a `stdClass`, so that every server reads them as a
/// map, and every other map is an array whose keys PHP stores as it stores string keys.
fn write_node(record: &mut PhpValue, value: &Value) -> Result<Node, Error> {
    match value {
        Value::Null => Ok(Node::Null),
        Value::Bool(value) => Ok(Node::Bool(*value)),
        Value::Number(value) => number_node(*value),
        Value::Str(text) | Value::Safe(text) => Ok(Node::String(text.as_bytes().to_vec())),
        Value::List(items) => {
            let array = record.new_array();
            for (index, item) in items.iter().enumerate() {
                let key = match i64::try_from(index) {
                    Ok(key) if !crate::fault::broken() => key,
                    Ok(_) | Err(_) => return Err(Error::Internal("a list of more items than i64")),
                };
                let node = write_node(record, item)?;
                record
                    .set_element(array, Key::Int(key), node)
                    .map_err(Error::RecordValue)?;
            }
            Ok(Node::Array(array))
        }
        Value::Map(map) if map.is_empty() || has_list_keys(map) => {
            let object = record.new_object();
            for (key, item) in map.iter() {
                let node = write_node(record, item)?;
                record
                    .set_property(object, key.as_bytes().to_vec(), node)
                    .map_err(Error::RecordValue)?;
            }
            Ok(Node::Object(object))
        }
        Value::Map(map) => {
            let array = record.new_array();
            for (key, item) in map.iter() {
                let node = write_node(record, item)?;
                record
                    .set_element(array, Key::of_string(key.as_bytes().to_vec()), node)
                    .map_err(Error::RecordValue)?;
            }
            Ok(Node::Array(array))
        }
        Value::Object(_) => Err(data(
            ErrorCode::E_DATA_UNSUPPORTED_TYPE,
            "a native object is no value of a session",
        )),
    }
}

/// A record whose top value is the value (HY-104.14).
///
/// # Errors
/// The error of the data model for a native object.
pub fn to_record(value: &Value) -> Result<PhpValue, Error> {
    let mut record = PhpValue::new();
    let root = write_node(&mut record, value)?;
    record.set_root(root).map_err(Error::RecordValue)?;
    Ok(record)
}

/// The value of a record (HY-104.13).
///
/// # Errors
/// The error of the data model for a value outside it.
pub fn from_record(record: &PhpValue) -> Result<Value, Error> {
    read_node(record, record.root(), 0)
}

/// A value that the session keeps where a map stands: a map, or a list read as the map of its indexes, because a PHP
/// array with the keys 0 to n-1 reads as a list (HY-104.13); another value is a stored value of another form
/// (HY-104.23).
fn as_map(value: Value) -> Result<OrderedMap, Error> {
    match value {
        Value::Map(map) => Ok((*map).clone()),
        Value::List(items) => {
            let mut map = OrderedMap::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                map.insert(index.to_string(), item.clone());
            }
            Ok(map)
        }
        Value::Null
        | Value::Bool(_)
        | Value::Number(_)
        | Value::Str(_)
        | Value::Safe(_)
        | Value::Object(_) => Err(Error::InvalidSessionRecord),
    }
}

fn get(store: &mut dyn Store, key: &str) -> Result<Option<Value>, SessionFailure> {
    match from_store(store.get(key))? {
        Some(record) => Ok(Some(kind(from_record(&record))?)),
        None => Ok(None),
    }
}

fn set(store: &mut dyn Store, key: &str, value: &Value) -> Result<(), SessionFailure> {
    let record = kind(to_record(value))?;
    from_store(store.set(key, &record))
}

/// The token of the session (HY-24.1, HY-24.14): the stored one, or a new one of 32 random bytes that the session keeps
/// when it holds none; a stored value of another form fails with `invalid_session_token`.
///
/// # Errors
/// `invalid_session_token`, the kind `random` of the session-store library, and a failure of the store.
pub fn token(store: &mut dyn Store) -> Result<String, SessionFailure> {
    match from_store(store.get(TOKEN_KEY))? {
        Some(record) => match record.root() {
            Node::String(bytes) => match std::str::from_utf8(bytes.as_slice()) {
                Ok(text) => Ok(kind(stored_token(text))?.to_owned()),
                Err(_) => Err(Failure::Kind(Error::InvalidSessionToken)),
            },
            Node::Null
            | Node::Bool(_)
            | Node::Int(_)
            | Node::Float(_)
            | Node::Array(_)
            | Node::Object(_)
            | Node::Reference(_) => Err(Failure::Kind(Error::InvalidSessionToken)),
        },
        None => new_token(store),
    }
}

fn new_token(store: &mut dyn Store) -> Result<String, SessionFailure> {
    let token = match polyspec_session_store::random_hex(crate::csrf::TOKEN_BYTES) {
        Ok(token) => token,
        Err(error) => return Err(Failure::Kind(Error::Sessions(error))),
    };
    set(store, TOKEN_KEY, &Value::Str(token.clone()))?;
    Ok(token)
}

/// Renews the session (HY-72.2): the store moves its values to a new identifier, and the session gets a new token.
///
/// # Errors
/// A failure of the store.
pub fn renew(store: &mut dyn Store) -> Result<String, SessionFailure> {
    from_store(store.renew())?;
    new_token(store)
}

/// Stores the flash values and the changed topics of a redirect for the next request (HY-25.2).
///
/// # Errors
/// The error of the data model for a value that has no record, and a failure of the store.
pub fn put_flash(
    store: &mut dyn Store,
    values: &OrderedMap,
    changed: &[String],
) -> Result<(), SessionFailure> {
    let mut flash = OrderedMap::with_capacity(2);
    flash.insert("values".to_owned(), Value::Map(Arc::new(values.clone())));
    flash.insert(
        "changed".to_owned(),
        Value::List(Arc::new(changed.iter().cloned().map(Value::Str).collect())),
    );
    set(store, FLASH_KEY, &Value::Map(Arc::new(flash)))
}

/// The flash values and the changed topics that the previous request stored, which the session then no longer holds
/// (HY-25.2); a missing member is empty, and a stored flash of another form fails with `invalid_session_record`
/// (HY-104.23).
///
/// # Errors
/// `invalid_session_record`, the error of the data model and a failure of the store.
pub fn take_flash(store: &mut dyn Store) -> Result<(OrderedMap, Vec<String>), SessionFailure> {
    let Some(stored) = get(store, FLASH_KEY)? else {
        return Ok((OrderedMap::new(), Vec::new()));
    };
    let flash = kind(as_map(stored))?;
    let values = match flash.get("values") {
        None => OrderedMap::new(),
        Some(values) => kind(as_map(values.clone()))?,
    };
    let changed = match flash.get("changed") {
        None => Vec::new(),
        Some(Value::List(topics)) => match values::texts(topics) {
            Some(changed) => changed,
            None => return Err(Failure::Kind(Error::InvalidSessionRecord)),
        },
        Some(_) => return Err(Failure::Kind(Error::InvalidSessionRecord)),
    };
    from_store(store.remove(FLASH_KEY))?;
    Ok((values, changed))
}

/// Every stored kept value, by region, each region a map from a path to its value (HY-104.22); every region of another
/// form fails (HY-104.23).
fn stored_kept(store: &mut dyn Store) -> Result<Vec<(String, OrderedMap)>, SessionFailure> {
    let Some(stored) = get(store, KEEP_KEY)? else {
        return Ok(Vec::new());
    };
    let regions = kind(as_map(stored))?;
    let mut kept = Vec::with_capacity(regions.len());
    for (region, paths) in regions.iter() {
        kept.push((region.clone(), kind(as_map(paths.clone()))?));
    }
    Ok(kept)
}

/// The kept server values of a region (HY-40.3): an empty map for a region that stored none.
///
/// # Errors
/// `invalid_session_record`, the error of the data model and a failure of the store.
pub fn kept(store: &mut dyn Store, region: &str) -> Result<OrderedMap, SessionFailure> {
    let kept = stored_kept(store)?;
    Ok(match kept.into_iter().find(|(name, _)| name == region) {
        Some((_, paths)) => paths,
        None => OrderedMap::new(),
    })
}

/// Keeps a server value of a region at a path (HY-40.1, HY-40.4); a value outside the data model has failed before,
/// when the caller made it a value of the data model.
///
/// # Errors
/// `invalid_session_record`, the error of the data model and a failure of the store.
pub fn keep(
    store: &mut dyn Store,
    region: &str,
    path: &str,
    value: &Value,
) -> Result<(), SessionFailure> {
    let mut kept = stored_kept(store)?;
    match kept.iter_mut().find(|(name, _)| name == region) {
        Some((_, paths)) => paths.insert(path.to_owned(), value.clone()),
        None => {
            let mut paths = OrderedMap::new();
            paths.insert(path.to_owned(), value.clone());
            kept.push((region.to_owned(), paths));
        }
    }
    let mut regions = OrderedMap::with_capacity(kept.len());
    for (name, paths) in kept {
        regions.insert(name, Value::Map(Arc::new(paths)));
    }
    set(store, KEEP_KEY, &Value::Map(Arc::new(regions)))
}
