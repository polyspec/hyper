//! The interface contract of the core, `interface.json`, which the tests of its shape and of its error codes read.

use std::path::PathBuf;

/// The interface contract of the core as JSON.
pub fn contract() -> Result<serde_json::Value, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("interface.json");
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
}
