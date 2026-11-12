//! Entity tags (HY-53, HY-122.10, HY-122.11).

use sha2::{Digest, Sha256};

use crate::csrf::to_hex;

/// The first 32 hexadecimal digits of the SHA-256 digest of the bytes.
fn digits(bytes: &[u8]) -> String {
    let mut text = to_hex(&Sha256::digest(bytes));
    text.truncate(32);
    text
}

/// The weak tag of a JSON response with status 200 (HY-53.1): `W/"<digits>"` of the body after each occurrence of the
/// masked token of the response is replaced by the session token, so two responses with the same data and token have
/// the same tag (HY-53.2).
#[must_use]
pub fn page_tag(body: &str, masked_token: &str, token: &str) -> String {
    let replaced = if masked_token.is_empty() {
        body.to_owned()
    } else {
        body.replace(masked_token, token)
    };
    format!("W/\"{}\"", digits(replaced.as_bytes()))
}

/// The strong tag of a representation (HY-122.10, HY-122.11): `"<digits>"` of the `Content-Type`, a line feed and the
/// body.
#[must_use]
pub fn representation_tag(content_type: &[u8], body: &[u8]) -> String {
    let mut bytes = Vec::with_capacity(content_type.len() + 1 + body.len());
    bytes.extend_from_slice(content_type);
    bytes.push(b'\n');
    bytes.extend_from_slice(body);
    format!("\"{}\"", digits(&bytes))
}

/// Whether a request whose `If-None-Match` equals the tag receives 304 (HY-53.4, HY-122.10).
#[must_use]
pub fn not_modified(if_none_match: Option<&str>, tag: &str) -> bool {
    if_none_match == Some(tag)
}
