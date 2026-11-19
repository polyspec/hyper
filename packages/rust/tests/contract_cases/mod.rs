//! The case files of `contracts/`, which the tests of the core read.

use std::path::{Path, PathBuf};

/// The JSON of the case file `file` of `contracts/`; a file that cannot be read or parsed fails the test.
pub fn cases(file: &str) -> serde_json::Value {
    json_file(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts")
            .join(file),
    )
}

/// The JSON of the file `path`; a file that cannot be read or parsed fails the test.
pub fn json_file(path: &Path) -> serde_json::Value {
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => panic!("{}: {error}", path.display()),
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => panic!("{}: {error}", path.display()),
    }
}
