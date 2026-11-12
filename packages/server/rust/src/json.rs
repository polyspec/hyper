//! The JSON text of hyper (HY-54.18 to HY-54.21): json writes and reads it, and the template data model gives
//! its values.

use polyspec_json::{parse, stringify, ParseOptions, StringifyOptions};
use polyspec_template::{bind_json, to_json_value, BindError, Value};

/// A failure of reading or writing a JSON text of hyper.
#[derive(Debug, Clone)]
pub enum JsonError {
    /// A text that json refuses (HY-54.21, kind `malformed_json`), with that rejection as its source.
    Malformed(polyspec_json::Error),
    /// A value outside the data model (HY-54.20, HY-44.9), with the kind of the template data model.
    DataModel(BindError),
}

/// Reads a JSON text into a value of the data model (HY-54.20): `parse` of json with its reading limit of 256
/// nested containers, then the conversion of VAL-12 with the depth of VAL-20.
///
/// # Errors
/// `Malformed` for a text that json refuses and `DataModel` for a value outside the data model.
pub fn read(text: &[u8]) -> Result<Value, JsonError> {
    let parsed = parse(text, &ParseOptions::default()).map_err(JsonError::Malformed)?;
    bind_json(&parsed).map_err(JsonError::DataModel)
}

/// Writes a value of the data model as JSON text (HY-54.18, HY-54.19).
///
/// # Errors
/// The error of the data model for a value that has no JSON form, such as a native object (VAL-19).
pub fn write(value: &Value) -> Result<String, BindError> {
    let json = to_json_value(value)?;
    Ok(stringify(&json, &StringifyOptions::default()))
}
