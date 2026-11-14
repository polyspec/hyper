//! The build id of an application (HY-125): the files that a build hashes, the stream of their bytes, its digest, the
//! form of a build id and the `build.json` that holds it.

use std::borrow::Cow;

use polyspec_template::Value;
use sha2::{Digest, Sha256};

use crate::csrf::to_hex;
use crate::Error;

/// The places of the files that a build writes, as the prefixes of their paths (HY-125.17).
const PLACES: [&str; 4] = ["public/assets/", "client/", "program/", "csr/"];

/// The files that hold the id or a copy of another file, which the hash leaves out (HY-125.16).
const LEFT_OUT: [&str; 3] = ["client/build.json", "program/build.json", "csr/index.html"];

/// The copies of the files below `public/assets` in the static shell (HY-125.16).
const SHELL_ASSETS: &str = "csr/assets/";

/// One file that a build writes: its path with the prefix of its place (HY-125.17) and its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// The path, such as `public/assets/hyper-a1.js` or `program/reads.json`.
    pub path: String,
    /// The bytes of the file.
    pub bytes: Vec<u8>,
}

/// The files of `outputs` that the build id hashes, in the order of their paths compared as bytes (HY-125.3,
/// HY-125.15, HY-125.16).
///
/// # Errors
/// `invalid_build` with the path for a path without the prefix of a place, with nothing after its prefix or with a
/// segment that is empty, `.` or `..`, and for a path that `outputs` holds twice (HY-125.17).
pub fn hashed(outputs: &[Output]) -> Result<Vec<&Output>, Error> {
    let mut files = Vec::with_capacity(outputs.len());
    for output in outputs {
        check_path(&output.path)?;
        if !left_out(&output.path) {
            files.push(output);
        }
    }
    files.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    let mut all: Vec<&str> = outputs.iter().map(|output| output.path.as_str()).collect();
    all.sort_unstable();
    for pair in all.windows(2) {
        if let [first, second] = pair {
            if first == second {
                return Err(Error::InvalidBuild(Cow::Owned(format!(
                    "the build writes {first} twice (HY-125.17)"
                ))));
            }
        }
    }
    Ok(files)
}

/// The paths of the files of `outputs` that the build id hashes, in the order in which it hashes them (HY-125.3), the
/// member `rules.hashed_paths` of the interface contract.
///
/// # Errors
/// The errors of [`hashed`].
pub fn hashed_paths(outputs: &[Output]) -> Result<Vec<String>, Error> {
    Ok(hashed(outputs)?
        .into_iter()
        .map(|file| file.path.clone())
        .collect())
}

/// The bytes that the build id hashes: for each hashed file in path order, its UTF-8 path, a NUL byte, its length as
/// 8 bytes big-endian and its bytes (HY-125.3).
///
/// # Errors
/// The errors of [`hashed`].
pub fn stream(outputs: &[Output]) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    for file in hashed(outputs)? {
        bytes.extend_from_slice(file.path.as_bytes());
        bytes.push(0);
        let length = match u64::try_from(file.bytes.len()) {
            Ok(length) if !crate::fault::broken() => length,
            Ok(_) | Err(_) => {
                return Err(Error::Internal(
                    "the length of a build file exceeds 64 bits",
                ))
            }
        };
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(&file.bytes);
    }
    Ok(bytes)
}

/// The build id of the files that a build writes: the lowercase hexadecimal SHA-256 digest of [`stream`] (HY-125.15).
///
/// # Errors
/// The errors of [`hashed`].
pub fn id(outputs: &[Output]) -> Result<String, Error> {
    Ok(to_hex(&Sha256::digest(stream(outputs)?)))
}

/// Checks the form of a build id: 64 lowercase hexadecimal characters (HY-125.19).
///
/// # Errors
/// `invalid_build` for any other text.
pub fn check_id(text: &str) -> Result<(), Error> {
    if text.len() == 64
        && text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        Ok(())
    } else {
        Err(Error::InvalidBuild(Cow::Borrowed(
            "a build id is not 64 lowercase hexadecimal characters (HY-125.19)",
        )))
    }
}

/// The text of `build.json` with the build id `id` (HY-125.18).
///
/// # Errors
/// `invalid_build` for an id of another form (HY-125.19).
pub fn file_text(id: &str) -> Result<String, Error> {
    check_id(id)?;
    Ok(format!("{{\"build\":\"{id}\"}}"))
}

/// The build id of the bytes of a `build.json` (HY-125.18): a JSON text that holds exactly the key `build` with a
/// build id.
///
/// # Errors
/// `invalid_build` for bytes that are not such a JSON text.
pub fn read(bytes: &[u8]) -> Result<String, Error> {
    let not_build = || {
        Error::InvalidBuild(Cow::Borrowed(
            "build.json does not hold exactly the key build with a build id (HY-125.18)",
        ))
    };
    let value = match crate::json::read(bytes) {
        Ok(value) => value,
        Err(_) => return Err(not_build()),
    };
    let Value::Map(map) = value else {
        return Err(not_build());
    };
    match (map.len(), map.get("build")) {
        (1, Some(Value::Str(id))) => match check_id(id) {
            Ok(()) => Ok(id.clone()),
            Err(_) => Err(not_build()),
        },
        _ => Err(not_build()),
    }
}

/// Whether the hash leaves out the file of `path` (HY-125.16).
fn left_out(path: &str) -> bool {
    LEFT_OUT.contains(&path) || path.starts_with(SHELL_ASSETS)
}

/// Checks the path of a file that a build writes (HY-125.17).
fn check_path(path: &str) -> Result<(), Error> {
    let rest = PLACES.iter().find_map(|place| path.strip_prefix(place));
    let valid = match rest {
        Some(rest) => {
            !rest.is_empty()
                && rest
                    .split('/')
                    .all(|segment| !matches!(segment, "" | "." | ".."))
        }
        None => false,
    };
    if valid {
        Ok(())
    } else {
        Err(Error::InvalidBuild(Cow::Owned(format!(
            "{path} is not the path of a file that a build writes (HY-125.17)"
        ))))
    }
}
