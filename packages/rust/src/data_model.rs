//! The data model check of hyper (HY-44.3, HY-44.6, HY-44.9): the host binding of the template data model for a value
//! that a host built (VAL-13), followed by a check that the bound value holds no native object (VAL-19). Both are the
//! functions of the template language, so the kind and the message of a failure are those of the template data model.

use polyspec_template::{bind_value, to_json_value, Value};

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
