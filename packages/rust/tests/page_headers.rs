//! The `Referrer-Policy` of the headers of a page response (HY-103.5, HY-103.6): the reply of the request states it,
//! and every page and JSON answer of the request has it, whatever its status, and so does the 304 of HY-53.

use polyspec_hyper::etag::page_tag;
use polyspec_hyper::front::{page_headers, PageHeaders, PageResponse};

const BODY: &str = r#"{"shared":{"csrf":"masked"}}"#;

fn response(
    status: u16,
    json: bool,
    referrer_policy: Option<&str>,
    if_none_match: Option<&str>,
) -> PageResponse {
    PageResponse {
        status,
        json,
        body: BODY.to_owned(),
        context: false,
        masked_token: "masked".to_owned(),
        token: "token".to_owned(),
        method: "GET".to_owned(),
        cache_control: None,
        if_none_match: if_none_match.map(str::to_owned),
        referrer_policy: referrer_policy.map(str::to_owned),
    }
}

fn names(headers: &PageHeaders) -> Vec<&str> {
    headers
        .headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect()
}

fn value<'a>(headers: &'a PageHeaders, name: &str) -> Option<&'a str> {
    headers
        .headers
        .iter()
        .find(|(header, _)| header == name)
        .map(|(_, value)| value.as_str())
}

#[test]
fn a_document_has_the_referrer_policy_of_its_reply() {
    // HY-103.5
    let headers = page_headers(&response(200, false, Some("no-referrer"), None));
    assert_eq!(
        names(&headers),
        ["Content-Type", "Cache-Control", "Vary", "Referrer-Policy"]
    );
    assert_eq!(value(&headers, "Referrer-Policy"), Some("no-referrer"));
}

#[test]
fn a_page_answer_of_any_status_has_the_referrer_policy_of_its_reply() {
    // HY-103.5: whatever its status.
    for (status, json) in [(403, false), (409, true), (422, false), (422, true)] {
        let headers = page_headers(&response(status, json, Some("same-origin"), None));
        assert_eq!(headers.status, status);
        assert_eq!(value(&headers, "Referrer-Policy"), Some("same-origin"));
    }
}

#[test]
fn a_json_answer_and_its_304_have_the_referrer_policy_of_the_reply() {
    // HY-103.5, HY-53.4
    let tag = page_tag(BODY, "masked", "token");
    let ok = page_headers(&response(200, true, Some("origin"), None));
    assert_eq!(
        names(&ok),
        [
            "Content-Type",
            "Cache-Control",
            "Vary",
            "Referrer-Policy",
            "ETag"
        ]
    );
    let not_modified = page_headers(&response(200, true, Some("origin"), Some(&tag)));
    assert_eq!(not_modified.status, 304);
    assert_eq!(
        names(&not_modified),
        ["Cache-Control", "Vary", "Referrer-Policy", "ETag"]
    );
    assert_eq!(value(&not_modified, "Referrer-Policy"), Some("origin"));
}

#[test]
fn a_page_answer_without_the_call_has_no_referrer_policy() {
    // HY-103.6
    for (status, json) in [(200, false), (200, true), (422, true)] {
        let headers = page_headers(&response(status, json, None, None));
        assert_eq!(value(&headers, "Referrer-Policy"), None);
    }
}
