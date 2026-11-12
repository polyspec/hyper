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

/// Whether a case runs in PHP and Python, whose binding gives the core every i64 (B-2); a case only of Node states
/// what the binding of Node refuses before the core runs.
fn runs_in_php(case: &Value) -> bool {
    match case.get("only") {
        None => true,
        Some(only) => only["languages"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|language| language == "php"),
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
        if is_binding_case(case) || !runs_in_php(case) {
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
    // HY-52.6, HY-52.16, HY-103.2, HY-103.9, HY-69.9
    let file = cases("reply.json");
    for (name, group_name) in [
        ("cacheControl", "cacheControl"),
        ("referrerPolicy", "referrerPolicy"),
        ("status", "status"),
    ] {
        'cases: for case in group(&file, group_name) {
            if is_binding_case(case) || !runs_in_php(case) {
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

fn route_list(file: &Value) -> Vec<(String, String)> {
    group(file, "routes")
        .iter()
        .map(|route| {
            (
                text(route, "name").to_owned(),
                text(route, "path").to_owned(),
            )
        })
        .collect()
}

fn check_match(case: &Value, found: Option<polyspec_hyper::router::Match>) {
    let expected = &case["result"];
    match found {
        None => assert!(expected.is_null(), "{}", case["id"]),
        Some(found) => {
            assert_eq!(
                Some(found.name.as_str()),
                expected["name"].as_str(),
                "{}",
                case["id"]
            );
            let params: Vec<(String, Value)> = found
                .params
                .into_iter()
                .map(|(n, v)| (n, Value::from(v)))
                .collect();
            let expected: Vec<(String, Value)> = match expected["params"].as_object() {
                Some(map) => map.iter().map(|(n, v)| (n.clone(), v.clone())).collect(),
                None => panic!("{}: no params", case["id"]),
            };
            assert_eq!(params, expected, "{}", case["id"]);
        }
    }
}

#[test]
fn routes_match_in_manifest_order() -> Result<(), Error> {
    // HY-4 to HY-8, HY-49
    for file_name in ["routes.json", "rest.json"] {
        let file = cases(file_name);
        let router = polyspec_hyper::router::Router::new(&route_list(&file))?;
        for case in group(&file, "cases") {
            check_match(case, router.find(text(case, "path")));
        }
        if let Some(base) = file["basePath"].as_str() {
            for case in group(&file, "baseCases") {
                check_match(case, router.find_under(base, text(case, "path")));
            }
        }
        for case in group(&file, "invalidPaths") {
            let refused = polyspec_hyper::router::route("x", text(case, "path"));
            assert!(
                matches!(refused, Err(Error::InvalidApplication(_))),
                "{}",
                case["id"]
            );
        }
    }
    Ok(())
}

fn from_hex(text: &str) -> Vec<u8> {
    let digit = |byte: u8| match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => panic!("no hexadecimal digit {byte}"),
    };
    text.as_bytes()
        .chunks(2)
        .map(|pair| digit(pair[0]) << 4 | digit(pair[1]))
        .collect()
}

#[test]
fn manifest_checks() {
    // HY-2, HY-2.9, HY-37, HY-40.2, HY-106.18
    let file = cases("manifest.json");
    let mut ran = 0;
    for case in group(&file, "checks") {
        let bytes = if let Some(manifest) = case.get("manifest") {
            manifest.to_string().into_bytes()
        } else if let Some(text) = case["text"].as_str() {
            text.as_bytes().to_vec()
        } else {
            from_hex(text(case, "bytes"))
        };
        let result = polyspec_hyper::manifest::read(&bytes);
        match (&result, case.get("raises")) {
            (Ok(_), None) => assert_eq!(case["read"].as_bool(), Some(true), "{}", case["id"]),
            (Err(error), Some(_)) => check_raises(case, error),
            (other, _) => panic!("{}: {other:?}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
    for case in group(&file, "reads") {
        let manifest = match polyspec_hyper::manifest::read(case["manifest"].to_string().as_bytes())
        {
            Ok(manifest) => manifest,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        let regions: Vec<&str> = manifest
            .regions
            .iter()
            .map(|region| region.name.as_str())
            .collect();
        assert_eq!(Value::from(regions), case["regions"], "{}", case["id"]);
        let routes: Vec<&str> = manifest
            .routes
            .iter()
            .map(|route| route.name.as_str())
            .collect();
        assert_eq!(Value::from(routes), case["routes"], "{}", case["id"]);
        assert_eq!(
            match manifest.page() {
                Ok(page) => Some(page),
                Err(error) => panic!("{}: {error}", case["id"]),
            },
            case["page"].as_str(),
            "{}",
            case["id"]
        );
        if let Some(name) = case["region"].as_str() {
            let Some(region) = manifest.region(name) else {
                panic!("{}: no region {name}", case["id"])
            };
            let keep: serde_json::Map<String, Value> = region
                .keep
                .iter()
                .map(|(path, kind)| (path.clone(), Value::from(kind.name())))
                .collect();
            assert_eq!(Value::Object(keep), case["keep"], "{}", case["id"]);
            assert_eq!(
                region.template.as_deref(),
                case["template"].as_str(),
                "{}",
                case["id"]
            );
            if let Some(kinds) = case["kinds"].as_array() {
                let wanted: Vec<&str> = kinds.iter().filter_map(Value::as_str).collect();
                let kept: Vec<&str> = region
                    .keep
                    .iter()
                    .filter(|(_, kind)| wanted.contains(&kind.name()))
                    .map(|(path, _)| path.as_str())
                    .collect();
                assert_eq!(Value::from(kept), case["keptPaths"], "{}", case["id"]);
            }
        }
    }
}

#[test]
fn json_text_is_written_and_read() {
    // HY-54.18 to HY-54.21, HY-44.9
    use polyspec_hyper::json::{read, write, JsonError};
    let file = cases("json.json");
    let kind = |error: &JsonError| match error {
        JsonError::Malformed(_) => "malformed_json".to_owned(),
        JsonError::DataModel(error) => error.code.as_str().to_owned(),
    };
    for section in ["encode", "decode"] {
        for case in group(&file, section) {
            let result = read(text(case, "json").as_bytes());
            match (&result, case.get("raises")) {
                (Ok(value), None) => {
                    if let Some(expected) = case["expected"].as_str() {
                        match write(value) {
                            Ok(written) => assert_eq!(written, expected, "{}", case["id"]),
                            Err(error) => panic!("{}: {error}", case["id"]),
                        }
                    } else {
                        assert_eq!(case["result"].as_str(), Some("value"), "{}", case["id"]);
                    }
                }
                (Err(error), Some(raises)) => {
                    assert_eq!(kind(error), text(raises, "kind"), "{}", case["id"])
                }
                (other, _) => panic!("{}: {other:?}", case["id"]),
            }
        }
    }
}

#[test]
fn read_data_keeps_only_the_read_paths() {
    // HY-73.29, HY-73.22
    use polyspec_hyper::json::{read, write};
    use polyspec_hyper::reads::{keep, Read};
    let file = cases("reads.json");
    let mut ran = 0;
    for case in group(&file, "cases") {
        let parse = |key: &str| match read(case[key].to_string().as_bytes()) {
            Ok(value) => value,
            Err(error) => panic!("{}: {error:?}", case["id"]),
        };
        let tree = match Read::from_value(&parse("reads")) {
            Ok(tree) => tree,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        let kept = keep(&parse("data"), &tree);
        match write(&kept) {
            Ok(text) => assert_eq!(text, case["kept"].to_string(), "{}", case["id"]),
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}
