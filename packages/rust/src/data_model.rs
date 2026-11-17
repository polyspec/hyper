//! The data model check of hyper (HY-44.3, HY-44.6, HY-44.10 to HY-44.12): the host binding of the template data model for a value
//! that a host built (VAL-13), followed by a check that the bound value holds no native object (VAL-19). Both are the
//! functions of the template language, so the kind and the message of a failure are those of the template data model.

use polyspec_template::{bind_value, to_json_value, OrderedMap, Value};

use crate::Error;

/// Checks that a value is a value of the data model (HY-44.6). `bind_value` judges every number (VAL-2, VAL-3) and the
/// depth of the lists and maps (VAL-20) and keeps a native object; `to_json_value`, which gives the JSON form that
/// `json::write` writes, then refuses a native object (VAL-19).
///
/// # Errors
/// `Error::DataModel` with the kind of the template data model: `data_number_not_finite`, `data_number_range`,
/// `data_depth` or `data_unsupported_type`.
pub fn check(value: &Value) -> Result<(), Error> {
    let bound = bind_value(value).map_err(Error::DataModel)?;
    to_json_value(&bound).map_err(Error::DataModel)?;
    Ok(())
}

/// Checks a map that a handler returned under the keys of the maps that hold it in the check (HY-44.11), the outermost
/// first, so the limit of VAL-20 counts those maps.
fn check_under(keys: &[&str], map: &OrderedMap) -> Result<(), Error> {
    let mut value = Value::map(map.clone());
    for key in keys.iter().rev() {
        let mut holder = OrderedMap::with_capacity(1);
        holder.insert((*key).to_owned(), value);
        value = Value::map(holder);
    }
    check(&value)
}

/// Checks the context map (HY-44.10, HY-44.11): the value of the key `context` of one map.
///
/// # Errors
/// As [`check`].
pub fn check_context(context: &OrderedMap) -> Result<(), Error> {
    check_under(&["context"], context)
}

/// Checks the map that the shared handler returned (HY-44.10, HY-44.11): the value of the key `shared` of one map.
///
/// # Errors
/// As [`check`].
pub fn check_shared(shared: &OrderedMap) -> Result<(), Error> {
    check_under(&["shared"], shared)
}

/// Checks the data of a region, which a loader or an action returned (HY-44.10, HY-44.11): the value of the name of
/// the region in the map `regions` of one map.
///
/// # Errors
/// As [`check`].
pub fn check_region(name: &str, data: &OrderedMap) -> Result<(), Error> {
    check_under(&["regions", name], data)
}
