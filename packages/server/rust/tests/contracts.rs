//! The cases of `contracts/` that this crate decides, run against the core (plan V-1). A case whose failure the binding
//! decides before the core runs (`invalid_argument_type`, and `invalid_number` of a value that is no integer) is the
//! binding's and is left to the generated tests (bindgen design G-5).

use std::fs;
use std::path::PathBuf;

use bindgen_core::Kinds;
use polyspec_hyper::media::{select, Selected, Selection, Served};
use polyspec_hyper::{csrf, etag, location, reply, Error};
use serde_json::Value;

fn cases(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts")
        .join(file);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => panic!("{}: {error}", path.display()),
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => panic!("{}: {error}", path.display()),
    }
}

fn group<'a>(value: &'a Value, name: &str) -> &'a Vec<Value> {
    match value.get(name).and_then(Value::as_array) {
        Some(group) => group,
        None => panic!("no group {name}"),
    }
}

fn text<'a>(case: &'a Value, key: &str) -> &'a str {
    match case.get(key).and_then(Value::as_str) {
        Some(text) => text,
        None => panic!("{}: no text {key}", case["id"]),
    }
}

/// Compares an error with `raises` (plan F-3).
fn check_raises(case: &Value, error: &Error) {
    let raises = &case["raises"];
    assert_eq!(error.kind(), text(raises, "kind"), "{}", case["id"]);
    assert_eq!(
        error.category().as_str(),
        text(raises, "category"),
        "{}",
        case["id"]
    );
    let status = match raises["status"].as_u64() {
        Some(status) => match u16::try_from(status) {
            Ok(status) => Some(status),
            Err(error) => panic!("{}: {error}", case["id"]),
        },
        None => None,
    };
    assert_eq!(status, error.status(), "{}", case["id"]);
    if let Some(message) = raises["message"].as_str() {
        assert_eq!(error.to_string(), message, "{}", case["id"]);
    }
}

fn is_binding_case(case: &Value) -> bool {
    matches!(
        case["raises"]["kind"].as_str(),
        Some("invalid_argument_type" | "invalid_text")
    )
}

#[test]
fn csrf_mask_verify_and_browser() {
    // HY-24.2, HY-24.4, HY-24.10 to HY-24.14
    let file = cases("csrf.json");
    let mut ran = 0;
    for case in group(&file, "mask") {
        let result = csrf::mask(text(case, "token"), text(case, "mask"));
        match (&result, case.get("raises")) {
            (Ok(value), None) => assert_eq!(value, text(case, "value"), "{}", case["id"]),
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
        ran += 1;
    }
    for case in group(&file, "verify") {
        let result = csrf::verify(text(case, "token"), text(case, "value"));
        match (&result, case.get("raises")) {
            (Ok(valid), None) => {
                assert_eq!(Some(*valid), case["valid"].as_bool(), "{}", case["id"])
            }
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
        ran += 1;
    }
    for case in group(&file, "browser") {
        let result = csrf::browser(text(case, "value"));
        match (&result, case.get("raises")) {
            (Ok(browser), None) => assert_eq!(
                browser.as_deref(),
                case["browser"].as_str(),
                "{}",
                case["id"]
            ),
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn redirect_locations_and_page_statuses() {
    // HY-46.1, HY-46.3, HY-58.6
    let file = cases("result.json");
    for case in group(&file, "redirect") {
        // B-3: the binding refuses a text that is not UTF-8 before the core runs.
        if case["notUtf8"].as_bool() == Some(true) {
            continue;
        }
        let result = location::redirect_location(text(case, "location"));
        match (&result, case.get("raises")) {
            (Ok(location), None) => {
                assert_eq!(Some(*location), case["redirect"].as_str(), "{}", case["id"])
            }
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
    }
    for case in group(&file, "page") {
        let Some(status) = case["status"].as_i64() else {
            continue;
        };
        let result = location::page_status(status);
        match (&result, case.get("raises")) {
            (Ok(status), None) => assert_eq!(
                Some(u64::from(*status)),
                case["result"].as_u64(),
                "{}",
                case["id"]
            ),
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
    }
}

/// The argument of a call, a JSON text, as the core receives it after the binding: `None` for an argument that the
/// binding decides (a value of another type, a float).
enum Argument {
    Text(String),
    Integer(i64),
    Null,
}

fn argument(json: &str) -> Option<Argument> {
    match serde_json::from_str::<Value>(json) {
        Ok(Value::String(text)) => Some(Argument::Text(text)),
        Ok(Value::Null) => Some(Argument::Null),
        Ok(Value::Number(number)) if !json.contains(['.', 'e', 'E']) => {
            number.as_i64().map(Argument::Integer)
        }
        Ok(_) | Err(_) => None,
    }
}

fn arguments(call: &Value) -> Option<(String, Vec<Argument>)> {
    let name = call[0].as_str()?.to_owned();
    let mut list = Vec::new();
    for json in call[1].as_array()? {
        list.push(argument(json.as_str()?)?);
    }
    Some((name, list))
}

#[test]
fn reply_cookies() {
    // HY-52.2, HY-52.13 to HY-52.16
    let file = cases("reply.json");
    let mut ran = 0;
    'cases: for case in group(&file, "cookies") {
        if is_binding_case(case) || case.get("only").is_some() {
            continue;
        }
        let secure = case["secure"].as_bool() == Some(true);
        let mut headers = Vec::new();
        let mut failure = None;
        for call in case["calls"].as_array().into_iter().flatten() {
            let Some((name, args)) = arguments(call) else {
                continue 'cases;
            };
            let result = match (name.as_str(), args.as_slice()) {
                ("cookie", [Argument::Text(n), Argument::Text(v)])
                | ("cookie", [Argument::Text(n), Argument::Text(v), Argument::Null]) => {
                    reply::cookie(n, v, None)
                }
                ("cookie", [Argument::Text(n), Argument::Text(v), Argument::Integer(age)]) => {
                    reply::cookie(n, v, Some(*age))
                }
                ("removeCookie", [Argument::Text(n)]) => reply::removed_cookie(n),
                _ => continue 'cases,
            };
            match result.and_then(|cookie| reply::set_cookie_field(&cookie, secure)) {
                Ok(field) => headers.push(String::from_utf8_lossy(&field).into_owned()),
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        match (failure, case.get("raises")) {
            (None, None) => {
                let expected: Vec<String> = case["headers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|header| header.as_str().map(str::to_owned))
                    .collect();
                assert_eq!(headers, expected, "{}", case["id"]);
            }
            (Some(error), Some(_)) => check_raises(case, &error),
            (failure, _) => panic!("{}: {failure:?}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn reply_cache_control_referrer_policy_and_status() {
    // HY-52.6, HY-52.16, HY-103.2, HY-103.9, HY-69.8
    let file = cases("reply.json");
    for (name, group_name) in [
        ("cacheControl", "cacheControl"),
        ("referrerPolicy", "referrerPolicy"),
        ("status", "status"),
    ] {
        'cases: for case in group(&file, group_name) {
            if is_binding_case(case) || case.get("only").is_some() {
                continue;
            }
            let mut value: Option<Value> = None;
            let mut failure = None;
            for call in case["calls"].as_array().into_iter().flatten() {
                let Some((called, args)) = arguments(call) else {
                    continue 'cases;
                };
                assert_eq!(called, name);
                let result = match args.as_slice() {
                    [Argument::Text(text)] if name == "cacheControl" => {
                        reply::cache_control(text).map(Value::from)
                    }
                    [Argument::Text(text)] if name == "referrerPolicy" => {
                        reply::referrer_policy(text).map(Value::from)
                    }
                    [Argument::Integer(status)] if name == "status" => {
                        reply::status(*status).map(Value::from)
                    }
                    _ => continue 'cases,
                };
                match result {
                    Ok(next) => value = Some(next),
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                }
            }
            match (failure, case.get("raises")) {
                (None, None) => assert_eq!(
                    match value {
                        Some(value) => value,
                        None => Value::Null,
                    },
                    case["value"],
                    "{}",
                    case["id"]
                ),
                (Some(error), Some(_)) => check_raises(case, &error),
                (failure, _) => panic!("{}: {failure:?}", case["id"]),
            }
        }
    }
}

#[test]
fn accept_selects_the_page_or_the_page_data() {
    // HY-116.11, HY-116.17 to HY-116.20
    let file = cases("accept.json");
    let served = Served {
        page: true,
        page_data: true,
    };
    let mut ran = 0;
    for case in group(&file, "select") {
        let lines: Vec<Vec<u8>> = match case["accept"].as_str() {
            // A case holds each byte of a field as the character U+0000 to U+00FF of the same number.
            Some(accept) => vec![accept
                .chars()
                .map(|c| match u8::try_from(u32::from(c)) {
                    Ok(byte) => byte,
                    Err(error) => panic!("{}: {error}", case["id"]),
                })
                .collect()],
            None => Vec::new(),
        };
        let result = select(&lines, served, &[]);
        match (&result, case.get("raises")) {
            (Ok(Selection::Selected(selected)), None) => {
                let name = match selected {
                    Selected::Page => "text/html",
                    Selected::PageData => "application/vnd.hyper+json",
                    Selected::Representation { .. } => {
                        panic!("{}: no entry was declared", case["id"])
                    }
                };
                assert_eq!(Some(name), case["selected"].as_str(), "{}", case["id"]);
            }
            (Ok(Selection::NotAcceptable { .. }), None) => {
                assert!(case["selected"].is_null(), "{}", case["id"])
            }
            (Err(error), Some(_)) => check_raises(case, error),
            _ => panic!("{}: {result:?}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn representation_tags() {
    // HY-122.10, HY-122.11: the cases whose body is already the JSON text of HY-54.18.
    let file = cases("media-type.json");
    let mut ran = 0;
    for case in group(&file, "values") {
        let Some(tag) = case["etag"].as_str() else {
            continue;
        };
        // A media type made without a content type tags with the empty type (HY-122.11).
        let body = text(case, "body").as_bytes();
        let computed = match case["contentType"].as_str() {
            Some(content_type) => etag::representation_tag(content_type.as_bytes(), body),
            None => etag::representation_tag(b"", body),
        };
        assert_eq!(computed, tag, "{}", case["id"]);
        ran += 1;
    }
    assert!(ran > 0);
}
