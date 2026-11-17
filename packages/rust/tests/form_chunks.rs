//! HY-131.26 (F-24.6 of http-form): the result of a `multipart/form-data` body read in chunks does not depend on the
//! chunks. The same body, given whole, in two chunks divided at every position and one byte at a time, gives the same
//! form values, the same files and the same failure. The rule moved from the readers of the three servers to the core
//! (H35.11), so its test is here.

use binding_core::{Io, Kinds};
use polyspec_hyper::form::{BodyLimits, RequestBody};

const TYPE: &[u8] = b"multipart/form-data; boundary=XyZ";

/// What a body gave: its fields, its files as name, filename, content type and bytes, or the kind of its failure.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Form { fields: Vec<(String, Vec<String>)>, files: Vec<(String, String, String, Vec<u8>)> },
    Failed(&'static str),
}

fn io() -> Io {
    Io::for_generated_call()
}

/// Reads `body` in the chunks that `ends` divides it at, and removes the directory of its files.
fn read(body: &[u8], ends: &[usize], limits: &BodyLimits) -> Outcome {
    let mut read = RequestBody::start(io(), Some(TYPE), None, true, limits).expect("the body starts");
    let mut start = 0;
    let mut failure = None;
    for &end in ends.iter().chain(std::iter::once(&body.len())) {
        if let Err(error) = read.feed(io(), &body[start..end]) {
            failure = Some(error.kind());
            break;
        }
        start = end;
    }
    if failure.is_none() {
        if let Err(error) = read.finish(io()) {
            failure = Some(error.kind());
        }
    }
    let outcome = match failure {
        Some(kind) => Outcome::Failed(kind),
        None => {
            let form = read.parts().expect("the parts of a finished body");
            let files = form
                .files
                .iter()
                .flat_map(|(_, files)| files.iter())
                .map(|file| (file.name(), file.filename(), file.content_type(), file.content(io()).expect("the bytes")))
                .collect();
            Outcome::Form { fields: form.fields, files }
        }
    };
    read.remove(io()).expect("the directory is removed");
    outcome
}

/// Every division of `body`: whole, in two chunks at every position, and one byte at a time.
fn divisions(body: &[u8]) -> Vec<Vec<usize>> {
    let mut all = vec![Vec::new()];
    all.extend((1..body.len()).map(|at| vec![at]));
    all.push((1..body.len()).collect());
    all
}

fn same_for_every_division(body: &[u8], limits: &BodyLimits) -> Outcome {
    let whole = read(body, &[], limits);
    for ends in divisions(body) {
        assert_eq!(read(body, &ends, limits), whole, "HY-131.26: the chunks that end at {ends:?} change the result");
    }
    whole
}

const WIDE: BodyLimits = BodyLimits { limit: 100_000, value_limit: 100_000, part_limit: 100, file_limit: 100_000 };

#[test]
fn a_form_with_values_and_a_file_does_not_depend_on_its_chunks() {
    let body = b"--XyZ\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name=\"f\"; filename=\"one.txt\"\r\nContent-Type: text/plain\r\n\r\nfirst\r\n--Xy file\r\n--XyZ--\r\n";
    let outcome = same_for_every_division(body, &WIDE);
    assert_eq!(
        outcome,
        Outcome::Form {
            fields: vec![("a".to_owned(), vec!["1".to_owned()])],
            files: vec![("f".to_owned(), "one.txt".to_owned(), "text/plain".to_owned(), b"first\r\n--Xy file".to_vec())],
        }
    );
}

#[test]
fn a_part_without_a_name_fails_alike_for_every_division() {
    // HY-113.23: a part without a name parameter fails the body with invalid.
    let body = b"--XyZ\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; filename=\"x.txt\"\r\n\r\nX\r\n--XyZ--\r\n";
    assert_eq!(same_for_every_division(body, &WIDE), Outcome::Failed("invalid"));
}

#[test]
fn a_passed_value_limit_fails_alike_for_every_division() {
    // HY-131.30: a text value above the value limit fails the body with value_limit.
    let body = b"--XyZ\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n0123456789\r\n--XyZ--\r\n";
    let limits = BodyLimits { value_limit: 4, ..WIDE };
    assert_eq!(same_for_every_division(body, &limits), Outcome::Failed("value_limit"));
}
