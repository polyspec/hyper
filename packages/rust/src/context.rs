//! The context of an application (HY-124 to HY-128): its place in the shared data, its JSON text and hash, the member
//! `context` of a JSON response, and the header `Hyper-Context` of a request.

use std::sync::Arc;

use polyspec_template::{OrderedMap, Value};
use sha2::{Digest, Sha256};

use crate::csrf::to_hex;
use crate::Error;

/// The header of a request that holds the context hash that the browser holds (HY-127.1).
pub const HEADER: &str = "Hyper-Context";

/// The shared data with the context in its place (HY-10.2, HY-10.3): right after `csrf`, or after `title` when the read
/// paths removed `csrf`, or first when they removed both; the order of the other members stays.
///
/// # Errors
/// `shared_holds_context` for shared data that already holds a member `context` (HY-10.3, HY-124.8).
pub fn with_context(shared: &OrderedMap, context: &Value) -> Result<OrderedMap, Error> {
    if shared.contains_key("context") {
        return Err(Error::SharedHoldsContext);
    }
    let anchor = if shared.contains_key("csrf") {
        "csrf"
    } else {
        "title"
    };
    let mut placed = OrderedMap::with_capacity(shared.len() + 1);
    if !shared.contains_key(anchor) {
        placed.insert("context".to_owned(), context.clone());
    }
    for (name, value) in shared.iter() {
        placed.insert(name.clone(), value.clone());
        if name == anchor {
            placed.insert("context".to_owned(), context.clone());
        }
    }
    Ok(placed)
}

/// The JSON text of HY-54 of a context (HY-125.10), which the member `value` of HY-128 and the hash share.
///
/// # Errors
/// The error of the data model for a context that has no JSON form (HY-125.9, HY-44).
pub fn text(context: &OrderedMap) -> Result<String, Error> {
    crate::json::write(&Value::Map(Arc::new(context.clone()))).map_err(Error::DataModel)
}

/// The context hash (HY-125.12): the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`, the
/// JSON text of the context, and `}`.
#[must_use]
pub fn hash(build: &str, text: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"{\"build\":\"");
    digest.update(build.as_bytes());
    digest.update(b"\",\"context\":");
    digest.update(text.as_bytes());
    digest.update(b"}");
    to_hex(&digest.finalize())
}

/// Whether a value of `Hyper-Context` is a context hash, 64 lowercase hexadecimal characters (HY-127.2); a request
/// without the header passes `None`, which is valid.
#[must_use]
pub fn valid_header(value: Option<&[u8]>) -> bool {
    match value {
        None => true,
        Some(value) => {
            value.len() == 64
                && value
                    .iter()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        }
    }
}

/// The member `context` of a JSON response (HY-128.2): `hash`, then `value` unless the request holds that hash
/// (HY-127); a document that embeds its data passes `None` as the held hash, so it always holds the value (HY-128.5).
///
/// # Errors
/// The error of the data model for a context that has no JSON form.
pub fn member(build: &str, context: &OrderedMap, held: Option<&str>) -> Result<OrderedMap, Error> {
    let hash = hash(build, &text(context)?);
    let mut member = OrderedMap::with_capacity(2);
    let send_value = held != Some(hash.as_str());
    member.insert("hash".to_owned(), Value::Str(hash));
    if send_value {
        member.insert("value".to_owned(), Value::Map(Arc::new(context.clone())));
    }
    Ok(member)
}
