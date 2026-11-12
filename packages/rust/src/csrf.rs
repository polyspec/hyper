//! The session token and its masked values (HY-24): the mask that a response carries, the check of the form field
//! `_csrf` and the value `browser()` of a request.

use sha2::{Digest, Sha256};

use crate::Error;

/// The bytes of a token and of a mask (HY-24.1, HY-24.2).
pub const TOKEN_BYTES: usize = 32;

const HEX: &[u8; 16] = b"0123456789abcdef";

/// Reads lowercase hexadecimal digits into bytes; another digit or an odd length gives none.
fn from_hex(text: &str) -> Option<Vec<u8>> {
    let digits = text.as_bytes();
    if !digits.len().is_multiple_of(2) {
        return None;
    }
    let value = |digit: u8| match digit {
        b'0'..=b'9' => Some(digit - b'0'),
        b'a'..=b'f' => Some(digit - b'a' + 10),
        _ => None,
    };
    digits
        .chunks(2)
        .map(|pair| Some(value(pair[0])? << 4 | value(pair[1])?))
        .collect()
}

/// Writes bytes as lowercase hexadecimal digits.
#[must_use]
pub fn to_hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(char::from(HEX[usize::from(byte >> 4)]));
        text.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    text
}

/// The 32 bytes of a token or a mask of 64 lowercase hexadecimal digits (HY-24.14).
fn thirty_two(text: &str) -> Result<Vec<u8>, Error> {
    match from_hex(text) {
        Some(bytes) if bytes.len() == TOKEN_BYTES => Ok(bytes),
        Some(_) | None => Err(Error::InvalidCsrfForm),
    }
}

/// The masked value of a token (HY-24.2): the mask `r`, then `r` XOR the token, as 128 lowercase hexadecimal digits.
/// The caller draws `r` anew for every response (HY-24.3).
///
/// # Errors
/// `invalid_csrf_form` for a token or a mask that is not 64 lowercase hexadecimal digits (HY-24.14).
pub fn mask(token: &str, mask: &str) -> Result<String, Error> {
    let token = thirty_two(token)?;
    let mask = thirty_two(mask)?;
    let mut bytes = mask.clone();
    bytes.extend(mask.iter().zip(&token).map(|(r, t)| r ^ t));
    Ok(to_hex(&bytes))
}

/// The token of a masked value: the second half XOR the first, or none when the value is not 128 lowercase
/// hexadecimal digits.
fn unmask(value: &str) -> Option<Vec<u8>> {
    let bytes = from_hex(value)?;
    if bytes.len() != 2 * TOKEN_BYTES {
        return None;
    }
    let (r, masked) = bytes.split_at(TOKEN_BYTES);
    Some(r.iter().zip(masked).map(|(r, m)| r ^ m).collect())
}

/// Whether a form value is a masked value of the token (HY-24.4), compared in constant time; a value that is not 128
/// lowercase hexadecimal digits is not valid (HY-24.5).
///
/// # Errors
/// `invalid_csrf_form` for a token that is not 64 lowercase hexadecimal digits (HY-24.14).
pub fn verify(token: &str, value: &str) -> Result<bool, Error> {
    let token = thirty_two(token)?;
    let Some(unmasked) = unmask(value) else {
        return Ok(false);
    };
    let difference = token
        .iter()
        .zip(&unmasked)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b));
    Ok(difference == 0)
}

/// The value `browser()` of a request (HY-24.10 to HY-24.13): the SHA-256 digest of the 32 bytes of the token of its
/// masked value as 64 lowercase hexadecimal digits, and none for the empty text of a request that opened no session.
///
/// # Errors
/// `invalid_csrf_form` for a value that is neither empty nor 128 lowercase hexadecimal digits (HY-24.13).
pub fn browser(masked: &str) -> Result<Option<String>, Error> {
    if masked.is_empty() {
        return Ok(None);
    }
    let Some(token) = unmask(masked) else {
        return Err(Error::InvalidCsrfForm);
    };
    Ok(Some(to_hex(&Sha256::digest(&token))))
}

/// Checks the token that a session holds (HY-24.14): a stored value of another form fails the request.
///
/// # Errors
/// `invalid_session_token`.
pub fn stored_token(stored: &str) -> Result<&str, Error> {
    match thirty_two(stored) {
        Ok(_) => Ok(stored),
        Err(_) => Err(Error::InvalidSessionToken),
    }
}
