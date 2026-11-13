//! The cases of `contracts/` that this crate decides, run against the core (plan V-1). A case whose failure the binding
//! decides before the core runs (`invalid_argument_type`, and `invalid_number` of a value that is no integer) is the
//! binding's and is left to the generated tests (binding design G-5).

use std::fs;
use std::path::PathBuf;

use binding_core::Kinds;
use polyspec_hyper::media::{select, Selected, Selection, Served};
use polyspec_hyper::{csrf, etag, location, reply, Error};
use serde_json::Value;

fn cases(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts")
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

/// Compares a result with its case: `ok` compares the value of a case that states no failure, and a failure is compared
/// with `raises`. A value where the case states a failure, and a failure where it states none, fail.
fn check<T: std::fmt::Debug>(case: &Value, result: &Result<T, Error>, ok: impl FnOnce(&T)) {
    match (result, case.get("raises")) {
        (Ok(value), None) => ok(value),
        (Err(error), Some(_)) => check_raises(case, error),
        _ => panic!("{}: {result:?}", case["id"]),
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
        check(case, &result, |value| {
            assert_eq!(value, text(case, "value"), "{}", case["id"])
        });
        ran += 1;
    }
    for case in group(&file, "verify") {
        let result = csrf::verify(text(case, "token"), text(case, "value"));
        check(case, &result, |valid| {
            assert_eq!(Some(*valid), case["valid"].as_bool(), "{}", case["id"])
        });
        ran += 1;
    }
    for case in group(&file, "browser") {
        let result = csrf::browser(text(case, "value"));
        check(case, &result, |browser| {
            assert_eq!(
                browser.as_deref(),
                case["browser"].as_str(),
                "{}",
                case["id"]
            )
        });
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
        check(case, &result, |location| {
            assert_eq!(Some(*location), case["redirect"].as_str(), "{}", case["id"])
        });
    }
    for case in group(&file, "page") {
        let Some(status) = case["status"].as_i64() else {
            continue;
        };
        let result = location::page_status(status);
        check(case, &result, |status| {
            assert_eq!(
                Some(u64::from(*status)),
                case["result"].as_u64(),
                "{}",
                case["id"]
            )
        });
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
        check(case, &result, |selection| match selection {
            Selection::Selected(selected) => {
                let name = match selected {
                    Selected::Page => "text/html",
                    Selected::PageData => "application/vnd.hyper+json",
                    Selected::Representation { .. } => {
                        panic!("{}: no entry was declared", case["id"])
                    }
                };
                assert_eq!(Some(name), case["selected"].as_str(), "{}", case["id"]);
            }
            Selection::NotAcceptable { .. } => {
                assert!(case["selected"].is_null(), "{}", case["id"])
            }
        });
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
    // HY-2, HY-2.9, HY-37, HY-40.2, HY-106.21
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
        check(case, &result, |_| {
            assert_eq!(case["read"].as_bool(), Some(true), "{}", case["id"])
        });
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

fn text_of(value: &Value) -> &str {
    match value.as_str() {
        Some(text) => text,
        None => panic!("no text: {value}"),
    }
}

/// A value of the data model as JSON for a comparison with a case.
fn as_json(value: &polyspec_template::Value) -> Value {
    match polyspec_hyper::json::write(value) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(json) => json,
            Err(error) => panic!("{error}"),
        },
        Err(error) => panic!("{error}"),
    }
}

fn pairs(map: &polyspec_template::OrderedMap) -> Value {
    Value::Array(
        map.iter()
            .map(|(key, value)| Value::Array(vec![Value::from(key.clone()), as_json(value)]))
            .collect(),
    )
}

fn data_value(json: &str) -> Result<polyspec_template::Value, Error> {
    match polyspec_hyper::json::read(json.as_bytes()) {
        Ok(value) => Ok(value),
        Err(polyspec_hyper::json::JsonError::DataModel(error)) => Err(Error::DataModel(error)),
        Err(polyspec_hyper::json::JsonError::Malformed(error)) => {
            panic!("{json}: {error:?}")
        }
    }
}

#[test]
fn session_values_are_kept_in_the_record() {
    // HY-24.1, HY-24.14, HY-25.2, HY-40, HY-72.2, HY-104.13, HY-104.14, HY-104.23
    use binding_core::Failure;
    use polyspec_hyper::session;
    use polyspec_session_store::{MemoryStore, Store};
    let file = cases("session.json");
    let mut ran = 0;
    for group_name in ["token", "flash", "kept"] {
        for case in group(&file, group_name) {
            let mut store = MemoryStore::new();
            for pair in case["stored"].as_array().into_iter().flatten() {
                let value = match data_value(text_of(&pair[1])) {
                    Ok(value) => value,
                    Err(error) => panic!("{error}"),
                };
                let record = match session::to_record(&value) {
                    Ok(record) => record,
                    Err(error) => panic!("{error}"),
                };
                if let Err(error) = store.set(text_of(&pair[0]), &record) {
                    panic!("{}: {error}", case["id"]);
                }
            }
            let mut results = Vec::new();
            let mut tokens: Vec<String> = Vec::new();
            let mut failure = None;
            for call in case["calls"].as_array().into_iter().flatten() {
                let name = text_of(&call[0]);
                let args: Vec<String> = call[1]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|a| a.as_str().map(str::to_owned))
                    .collect();
                let text_arg = |index: usize| match serde_json::from_str::<Value>(&args[index]) {
                    Ok(Value::String(text)) => text,
                    other => panic!("{}: {other:?}", case["id"]),
                };
                let outcome: Result<Value, Failure<Error>> = match name {
                    "csrfToken" => session::token(&mut store).map(|token| {
                        if !tokens.contains(&token) {
                            tokens.push(token.clone());
                        }
                        let index = match tokens.iter().position(|t| t == &token) {
                            Some(index) => index + 1,
                            None => panic!("a token that the list holds"),
                        };
                        Value::from(index)
                    }),
                    "renew" => session::renew(&mut store).map(|_| Value::Null),
                    "putFlash" => match (data_value(&args[0]), data_value(&args[1])) {
                        (Ok(polyspec_template::Value::Map(values)), Ok(polyspec_template::Value::List(topics))) => {
                            let changed: Vec<String> = topics
                                .iter()
                                .map(|topic| match topic {
                                    polyspec_template::Value::Str(topic) => topic.clone(),
                                    other => panic!("{other:?}"),
                                })
                                .collect();
                            session::put_flash(&mut store, &values, &changed).map(|()| Value::Null)
                        }
                        other => panic!("{}: {other:?}", case["id"]),
                    },
                    "takeFlash" => session::take_flash(&mut store).map(|(values, changed)| {
                        serde_json::json!({"values": pairs(&values), "changed": changed})
                    }),
                    "kept" => session::kept(&mut store, &text_arg(0)).map(|map| pairs(&map)),
                    "keep" => match data_value(&args[2]) {
                        Ok(value) => session::keep(&mut store, &text_arg(0), &text_arg(1), &value).map(|()| Value::Null),
                        Err(error) => Err(Failure::Kind(error)),
                    },
                    other => panic!("{}: call {other}", case["id"]),
                };
                match outcome {
                    Ok(value) => results.push(value),
                    Err(Failure::Kind(error)) => {
                        failure = Some(error);
                        break;
                    }
                    Err(Failure::Raised(_) | Failure::Callback(_)) => {
                        panic!("{}: a raised exception of no store", case["id"])
                    }
                }
            }
            match (failure, case.get("raises")) {
                (None, None) => {
                    if group_name == "token" {
                        let tokens: Vec<Value> = results
                            .into_iter()
                            .filter(|value| !value.is_null())
                            .collect();
                        assert_eq!(Value::from(tokens), case["tokens"], "{}", case["id"]);
                        let renewals = case["renewals"].as_u64();
                        assert_eq!(Some(store.renewals()), renewals, "{}", case["id"]);
                    } else {
                        assert_eq!(Value::from(results), case["results"], "{}", case["id"]);
                    }
                }
                (Some(error), Some(_)) => {
                    check_raises(case, &error);
                    assert_eq!(Value::from(results), case["results"], "{}", case["id"]);
                }
                (failure, _) => panic!("{}: {failure:?} after {results:?}", case["id"]),
            }
            ran += 1;
        }
    }
    assert!(ran > 0);
}

/// The pairs of path and value of a case of `keep.json`, as values of the data model.
fn kept_pairs(case: &Value) -> Vec<(String, polyspec_template::Value)> {
    case["kept"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|pair| match data_value(&pair[1].to_string()) {
            Ok(value) => (text_of(&pair[0]).to_owned(), value),
            Err(error) => panic!("{}: {error}", case["id"]),
        })
        .collect()
}

#[test]
fn kept_values_conform_to_the_region_data() {
    // HY-38.2 to HY-38.9, HY-38.19
    use polyspec_hyper::keep::{apply, select};
    let file = cases("keep.json");
    let mut ran = 0;
    for case in group(&file, "cases") {
        let data = match data_value(&case["data"].to_string()) {
            Ok(data) => data,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        let applied = apply(&data, &kept_pairs(case));
        // `ordered`: the keys keep their order (HY-38.19).
        match polyspec_hyper::json::write(&applied) {
            Ok(written) => assert_eq!(written, case["expected"].to_string(), "{}", case["id"]),
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    for case in group(&file, "select") {
        let data = match data_value(&case["data"].to_string()) {
            Ok(data) => data,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        let (selected, _) = select(&data, &kept_pairs(case));
        assert_eq!(
            as_json(&polyspec_template::Value::Map(std::sync::Arc::new(
                selected
            ))),
            case["selected"],
            "{}",
            case["id"]
        );
        // HY-38.9: the region data stays as the loader gave it.
        assert_eq!(
            as_json(&data) == case["data"],
            case["unchanged"].as_bool() == Some(true),
            "{}",
            case["id"]
        );
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn the_context_hash_and_its_place() {
    // HY-125.10, HY-125.12, HY-10.3, HY-124.8
    use polyspec_hyper::context::{hash, with_context};
    let file = cases("context.json");
    let mut ran = 0;
    for case in group(&file, "contexts") {
        let context = match data_value(text(case, "context")) {
            Ok(polyspec_template::Value::Map(map)) => map,
            Ok(_) | Err(_) => panic!("{}: the context is no map", case["id"]),
        };
        let build = text(case, "build");
        let written = match polyspec_hyper::context::text(&context) {
            Ok(written) => written,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        assert_eq!(
            format!("{{\"build\":\"{build}\",\"context\":{written}}}"),
            text(case, "text"),
            "{}",
            case["id"]
        );
        let found = hash(build, &written);
        assert_eq!(found, text(case, "hash"), "{}", case["id"]);
        if let Some(reordered) = case.get("reorderedHash").and_then(Value::as_str) {
            assert_ne!(found, reordered, "{}", case["id"]);
        }
        ran += 1;
    }
    let context = polyspec_template::Value::text("Board");
    for case in group(&file, "withContext") {
        let mut shared = polyspec_template::OrderedMap::new();
        for key in case["shared"].as_array().into_iter().flatten() {
            shared.insert(text_of(key).to_owned(), polyspec_template::Value::Null);
        }
        match with_context(&shared, &context) {
            Ok(placed) => {
                let keys: Vec<&str> = placed.keys().map(String::as_str).collect();
                let expected: Vec<&str> = case["keys"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(text_of)
                    .collect();
                assert_eq!(keys, expected, "{}", case["id"]);
            }
            Err(error) => check_raises(case, &error),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

/// The bytes of a header as a case writes them: each character is one byte (HY-97.4).
fn latin1(text: &str) -> Vec<u8> {
    text.chars()
        .map(|ch| match u8::try_from(u32::from(ch)) {
            Ok(byte) => byte,
            Err(error) => panic!("{text}: {error}"),
        })
        .collect()
}

#[test]
fn the_current_path_of_a_request() {
    // HY-11.4
    use polyspec_hyper::page::current_path;
    let file = cases("request.json");
    let mut ran = 0;
    for case in group(&file, "values") {
        let Some(expected) = case.get("currentPath") else {
            continue;
        };
        let header = case["request"]["headers"]["HX-Current-URL"]
            .as_str()
            .map(latin1);
        assert_eq!(
            current_path(header.as_deref()).as_deref(),
            expected.as_str(),
            "{}",
            case["id"]
        );
        ran += 1;
    }
    assert!(ran > 0);
}

/// The engine and the manifest of an application of the fixture `applications` of `app.json`.
fn application(
    file: &Value,
    name: &str,
) -> (
    polyspec_hyper::render::Templates,
    polyspec_hyper::manifest::Manifest,
) {
    let fixture = &file["applications"][name];
    let sources: Vec<(String, String)> = fixture["templates"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(template, source)| (template.clone(), text_of(source).to_owned()))
        .collect();
    let templates =
        match polyspec_hyper::render::Templates::new(&sources, std::collections::HashMap::new()) {
            Ok(templates) => templates,
            Err(error) => panic!("{name}: {error}"),
        };
    match polyspec_hyper::manifest::read(fixture["manifest"].to_string().as_bytes()) {
        Ok(manifest) => (templates, manifest),
        Err(error) => panic!("{name}: {error}"),
    }
}

#[test]
fn a_document_holds_its_parts_rendered_alone() {
    // HY-12.1, HY-13.1, HY-13.2, HY-13.3
    use polyspec_hyper::render::Document;
    let file = cases("app.json");
    let mut ran = 0;
    for case in group(&file, "parts") {
        let name = text(case, "application");
        let (templates, manifest) = application(&file, name);
        let Some(route) = manifest
            .routes
            .iter()
            .find(|route| route.name == text(case, "route"))
        else {
            panic!("{}: no route", case["id"]);
        };
        let shared = match data_value(&case["shared"].to_string()) {
            Ok(polyspec_template::Value::Map(map)) => map,
            Ok(_) | Err(_) => panic!("{}: the shared data is no map", case["id"]),
        };
        let regions: Vec<(String, polyspec_template::Value)> = case["regions"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(region, data)| match data_value(&data.to_string()) {
                Ok(data) => (region.clone(), data),
                Err(error) => panic!("{}: {error}", case["id"]),
            })
            .collect();
        let kept = polyspec_template::OrderedMap::new();
        let document = Document {
            manifest: &manifest,
            route,
            shared: &shared,
            regions: &regions,
            kept: &kept,
            env: polyspec_template::Env {
                timezone: text(&file["applications"][name], "timezone").to_owned(),
                now: 0.0,
            },
            build: text(&file["applications"][name], "build"),
            embed: None,
        };
        let rendered = match templates.render_document(&document) {
            Ok(rendered) => rendered,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        let parts = &case["parts"];
        let mut expected = text(case, "frame").replace("{# title}", text(case, "title"));
        for region in &manifest.regions {
            let part = match (region.page, case.get("pageFrame")) {
                (true, Some(frame)) => {
                    let mut page = text_of(frame).to_owned();
                    for route_region in &route.regions {
                        page = page.replace(
                            &format!("{{# {}}}", route_region.name),
                            text(parts, &route_region.name),
                        );
                    }
                    assert_eq!(page, text(parts, &region.name), "{}", case["id"]);
                    page
                }
                _ => text(parts, &region.name).to_owned(),
            };
            expected = expected.replace(&format!("{{# {}}}", region.name), &part);
        }
        assert_eq!(rendered, expected, "{}", case["id"]);
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn a_region_that_fails_with_its_kept_values_renders_with_its_loader_data() {
    // HY-38.16, HY-38.17, HY-38.18, HY-31.2, HY-31.3
    use polyspec_hyper::page::{json_value, kept_values, Response};
    use polyspec_hyper::render::Document;
    let file = cases("app.json");
    let (templates, manifest) = application(&file, "a_board");
    let Some(route) = manifest.routes.iter().find(|route| route.name == "list") else {
        panic!("no route list");
    };
    let fixture = &file["applications"]["a_board"];
    let render = |tags: &str, cookie: &str| {
        let regions = vec![
            ("side".to_owned(), data_value(r#"{"count":0,"note":null}"#)),
            ("content".to_owned(), data_value("{}")),
            (
                "rows".to_owned(),
                data_value(&format!(
                    r#"{{"items":["a<","b0"],"open":false,"mode":"a","view":"x","filter":{{"a":1}},"tags":{tags}}}"#
                )),
            ),
        ];
        let regions: Vec<(String, polyspec_template::Value)> = regions
            .into_iter()
            .map(|(name, value)| match value {
                Ok(value) => (name, value),
                Err(error) => panic!("{error}"),
            })
            .collect();
        let cookie = polyspec_hyper::keep::cookie_values(cookie);
        let kept = kept_values(&manifest, &regions, &[], &cookie);
        let shared = match polyspec_hyper::page::shared_data("List", "t", None) {
            Ok(shared) => shared,
            Err(error) => panic!("{error}"),
        };
        let value = json_value(Response {
            timezone: "+09:00",
            route: "list",
            params: &[],
            build: text(fixture, "build"),
            context: None,
            shared: shared.clone(),
            regions: regions.clone(),
            kept: kept.clone(),
        });
        templates.render_document(&Document {
            manifest: &manifest,
            route,
            shared: &shared,
            regions: &regions,
            kept: &kept,
            env: polyspec_template::Env {
                timezone: "+09:00".to_owned(),
                now: 0.0,
            },
            build: text(fixture, "build"),
            embed: Some(&value),
        })
    };
    match render("[]", r#"{"rows":{"mode":"b","tags":[1]}}"#) {
        Ok(document) => {
            assert!(document.contains("<li>a&lt;</li><li>b0</li>"), "{document}");
            assert!(document.contains(r#""kept":{}"#), "{document}");
            assert!(document.contains(r#""mode":"a""#), "{document}");
            assert!(document.contains(r#"<"#), "{document}");
        }
        Err(error) => panic!("{error}"),
    }
    match render("[]", r#"{"rows":{"mode":"b"}}"#) {
        Ok(document) => assert!(
            document.contains(r#""kept":{"rows":{"mode":"b"}}"#),
            "{document}"
        ),
        Err(error) => panic!("{error}"),
    }
    match render("[1]", r#"{"rows":{"mode":"b"}}"#) {
        Err(binding_core::Failure::Kind(Error::Template(_))) => {}
        Err(error) => panic!("{error}"),
        Ok(document) => panic!("{document}"),
    }
}

/// The application `a_board` of `app.json` as the steps of a page hold it, every path read whole.
fn board(context: bool) -> polyspec_hyper::steps::Pages {
    board_under(context, "")
}

/// The application `a_board` under a base path, with client rendering under `/_props` and urlencoded forms.
fn board_under(context: bool, base_path: &str) -> polyspec_hyper::steps::Pages {
    use polyspec_hyper::reads::Read;
    use polyspec_hyper::steps::{Application, Pages, RouteReads};
    let file = cases("app.json");
    let (templates, manifest) = application(&file, "a_board");
    let fixture = &file["applications"]["a_board"];
    let names: Vec<String> = manifest
        .regions
        .iter()
        .chain(
            manifest
                .routes
                .iter()
                .flat_map(|route| route.regions.iter()),
        )
        .map(|region| region.name.clone())
        .collect();
    let reads = manifest
        .routes
        .iter()
        .map(|route| {
            (
                route.name.clone(),
                RouteReads {
                    shared: Read::Whole,
                    regions: names
                        .iter()
                        .map(|name| (name.clone(), Read::Whole))
                        .collect(),
                },
            )
        })
        .collect();
    Pages::from_application(Application {
        manifest,
        templates,
        reads,
        build: text(fixture, "build").to_owned(),
        timezone: text(fixture, "timezone").to_owned(),
        context,
        declared: polyspec_hyper::front::Declared {
            base_path: base_path.to_owned(),
            data_base_path: Some("/_props".to_owned()),
            form_types: vec!["application/x-www-form-urlencoded".to_owned()],
        },
    })
}

fn map(json: &str) -> polyspec_hyper::steps::Map<polyspec_template::Value> {
    match data_value(json) {
        Ok(polyspec_template::Value::Map(map)) => {
            let mut boundary = polyspec_hyper::steps::Map::new();
            for (key, value) in map.iter() {
                boundary.insert(key.clone(), value.clone());
            }
            boundary
        }
        Ok(_) | Err(_) => panic!("{json} is no map"),
    }
}

/// Runs the steps of a page, answering each call from the list in order, and gives the calls and the answer.
fn run_page(
    app: &polyspec_hyper::steps::Pages,
    input: polyspec_hyper::steps::PageInput,
    results: Vec<polyspec_hyper::steps::Input>,
) -> (
    Vec<polyspec_hyper::steps::Call>,
    polyspec_hyper::steps::Answer,
) {
    use polyspec_hyper::steps::{Input, PageRequest, Step};
    let mut page = match PageRequest::new(app, &input) {
        Ok(page) => page,
        Err(error) => panic!("{error}"),
    };
    let mut calls = Vec::new();
    let mut results = results.into_iter();
    let mut input = Input::Start;
    loop {
        match page.next(&input) {
            Ok(Step::Call { call }) => {
                calls.push(call);
                input = match results.next() {
                    Some(result) => result,
                    None => panic!("no result for {calls:?}"),
                };
            }
            Ok(Step::Answer { answer }) => return (calls, answer),
            Err(error) => panic!("{calls:?}: {error}"),
        }
    }
}

fn page_input(
    route: &str,
    kind: polyspec_hyper::steps::PageKind,
    action: bool,
) -> polyspec_hyper::steps::PageInput {
    polyspec_hyper::steps::PageInput {
        route: route.to_owned(),
        params: polyspec_hyper::steps::Map::new(),
        kind,
        action,
        csrf: "t".to_owned(),
        changed: Vec::new(),
        stored: polyspec_hyper::steps::Map::new(),
        keep_cookie: None,
        held_hash: None,
        now: 0.0,
    }
}

#[test]
fn the_steps_of_a_page_ask_the_host_for_each_handler() {
    // HY-124.2, HY-124.4, HY-18, HY-26.2, HY-58.3, HY-75.1, HY-128.2
    use polyspec_hyper::steps::{ActionOutcome, Answer, Call, Input, PageKind};
    let app = board(false);
    let (calls, answer) = run_page(
        &app,
        page_input("list", PageKind::Html, false),
        vec![
            Input::NoHandler,
            Input::Loaded {
                data: map(r#"{"count":1,"note":null}"#),
            },
            Input::NoHandler,
            Input::Loaded {
                data: map(r#"{"items":["x"],"tags":[]}"#),
            },
            Input::Reply {
                embeds: false,
                status: None,
            },
        ],
    );
    assert_eq!(
        calls,
        [
            Call::Shared,
            Call::RegionLoader {
                region: "side".to_owned()
            },
            Call::RouteLoader,
            Call::RouteRegionLoader {
                region: "rows".to_owned()
            },
            Call::Reply
        ]
    );
    match answer {
        Answer::Document { status, html } => {
            assert_eq!(status, 200);
            assert!(html.contains("<title>List - Site</title>"), "{html}");
            assert!(html.contains("<ul id=\"rows\"><li>x</li></ul>"), "{html}");
        }
        other => panic!("{other:?}"),
    }

    // A route region whose loader returns null is absent (HY-75.1), and the reply gives a page with status 200 its
    // status (HY-69).
    let (_, answer) = run_page(
        &app,
        page_input("list", PageKind::DocumentJson, false),
        vec![
            Input::NoHandler,
            Input::NoHandler,
            Input::NoHandler,
            Input::Absent,
            Input::Reply {
                embeds: true,
                status: Some(403),
            },
        ],
    );
    assert_eq!(
        answer,
        Answer::Json {
            status: 403,
            text: concat!(
                r#"{"env":{"timezone":"+09:00"},"route":"list","params":{},"#,
                r#""build":"1111111111111111111111111111111111111111111111111111111111111111","#,
                r#""shared":{"title":"List","csrf":"t"},"regions":{"side":{},"content":{}},"kept":{}}"#
            )
            .to_owned()
        }
    );

    // An action that redirects, stops or fails causes no call of the context handler (HY-124.4).
    let with_context = board(true);
    let (calls, answer) = run_page(
        &with_context,
        page_input("add", PageKind::Html, true),
        vec![Input::Action {
            outcome: ActionOutcome::NoPage,
        }],
    );
    assert_eq!(calls, [Call::Action]);
    assert_eq!(answer, Answer::NoPage);

    // An action that returns the route page calls the context handler after it and before the shared handler, and
    // its data replaces the route data (HY-124.2, HY-26.2); a region request holds the page region alone (HY-18.2).
    let (calls, answer) = run_page(
        &with_context,
        page_input("add", PageKind::RegionJson, true),
        vec![
            Input::Action {
                outcome: ActionOutcome::Page {
                    status: 422,
                    data: map(r#"{"error":"e"}"#),
                },
            },
            Input::Context {
                context: map(r#"{"name":"Board"}"#),
            },
            Input::NoHandler,
            Input::Loaded {
                data: map(r#"{"name":"n","error":null}"#),
            },
            Input::Reply {
                embeds: false,
                status: Some(403),
            },
        ],
    );
    assert_eq!(
        calls,
        [
            Call::Action,
            Call::Context,
            Call::Shared,
            Call::RouteLoader,
            Call::Reply
        ]
    );
    match answer {
        Answer::Json { status, text } => {
            assert_eq!(status, 422);
            assert!(
                text.contains(r#""context":{"hash":"#)
                    && text.contains(r#""value":{"name":"Board"}"#),
                "{text}"
            );
            assert!(
                text.contains(r#""regions":{"content":{"name":"n","error":"e"}}"#),
                "{text}"
            );
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_page_refuses_the_result_of_another_call() {
    use polyspec_hyper::steps::{Input, PageKind, PageRequest, Step};
    let app = board(false);
    let mut page = match PageRequest::new(&app, &page_input("home", PageKind::Html, false)) {
        Ok(page) => page,
        Err(error) => panic!("{error}"),
    };
    assert!(matches!(page.next(&Input::Start), Ok(Step::Call { .. })));
    match page.next(&Input::Absent) {
        Err(binding_core::Failure::Kind(error)) => {
            assert_eq!(binding_core::Kinds::kind(&error), "internal")
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_declaration_of_client_rendering_is_checked_when_the_application_opens() {
    // HY-62.5, HY-62.6, HY-62.15, HY-62.35, HY-62.37, HY-62.39
    use polyspec_hyper::client_rendering::{check_declaration, check_shell_path, shell_text};
    let file = cases("client.json");
    let (_, manifest) = application(&cases("app.json"), "a_board");
    let shell = text(&file, "shell");
    let mut ran = 0;
    for case in group(&file, "openRejections") {
        let base = match case.get("dataBasePath") {
            Some(base) => text_of(base),
            None => text(&file, "basePath"),
        };
        let path = "/srv/shell/index.html";
        let result = match text(case, "shellFile") {
            "relative" => check_shell_path("shell/index.html"),
            "not-utf8" => shell_text(path, vec![0xff]).map(|_| ()),
            "other-base" => check_declaration(
                &manifest,
                base,
                path,
                &shell.replace("content=\"/_props\"", "content=\"/_other\""),
            ),
            "declared" => check_declaration(&manifest, base, path, shell),
            // The host reads the shell file: a file that does not exist, a directory and a file that it may not read
            // fail its read, which it reports with `unreadable_shell`.
            "missing" | "directory" | "unreadable" => continue,
            other => panic!("{}: {other}", case["id"]),
        };
        match result {
            Err(error) => check_raises(case, &error),
            Ok(()) => panic!("{}: opened", case["id"]),
        }
        ran += 1;
    }
    assert_eq!(ran, 6);
    let declared = check_declaration(
        &manifest,
        text(&file, "basePath"),
        "/srv/shell/index.html",
        shell,
    );
    assert!(declared.is_ok(), "{declared:?}");
}

#[test]
fn the_route_of_a_request_before_its_page() -> Result<(), Error> {
    // HY-62.16 to HY-62.23, HY-40.1, HY-27.6, HY-116.12, HY-116.13, HY-116.18, HY-127.2, HY-59.12, HY-15.1
    use polyspec_hyper::front::{route_request, Front, Plain, Route};
    use polyspec_hyper::steps::PageKind;
    let pages = board(false);
    let with_context = board(true);
    let front = |method: &str, path: &str, accept: &str| Front {
        method: method.to_owned(),
        path: path.to_owned(),
        accept: vec![accept.as_bytes().to_vec()],
        hx_request: false,
        context_header: None,
        media_type: Some("application/x-www-form-urlencoded".to_owned()),
        malformed_content_type: false,
    };
    let page = |route: &str, kind: PageKind, action: bool| Route::Page {
        route: route.to_owned(),
        params: Vec::new(),
        kind,
        action,
    };
    let refused = |status: u16, body: &str, allow: Option<&str>, vary_accept: bool| Route::Plain {
        answer: Plain {
            status,
            body: body.as_bytes().to_vec(),
            allow: allow.map(str::to_owned),
            vary_accept,
        },
    };
    let html = "text/html";
    let json = "application/vnd.hyper+json";
    let route = |front: &Front, chosen: bool| route_request(&pages, chosen, front);
    assert_eq!(
        route(&front("GET", "/list", html), false)?,
        page("list", PageKind::Html, false)
    );
    assert_eq!(
        route(
            &Front {
                hx_request: true,
                ..front("GET", "/list", json)
            },
            false
        )?,
        page("list", PageKind::RegionJson, false)
    );
    assert_eq!(
        route(&front("GET", "/list", json), false)?,
        page("list", PageKind::DocumentJson, false)
    );
    assert_eq!(
        route(&front("POST", "/list", html), false)?,
        refused(405, "Method Not Allowed", Some("GET, HEAD"), false)
    );
    assert_eq!(
        route(&front("POST", "/add", html), false)?,
        page("add", PageKind::Html, true)
    );
    assert_eq!(
        route(
            &Front {
                media_type: Some("text/plain".to_owned()),
                ..front("POST", "/add", html)
            },
            false
        )?,
        refused(415, "Unsupported Media Type", None, false)
    );
    assert_eq!(
        route(
            &Front {
                malformed_content_type: true,
                ..front("POST", "/add", html)
            },
            false
        )?,
        refused(400, "Bad Request", None, false)
    );
    assert_eq!(
        route(&front("GET", "/nowhere", html), false)?,
        refused(404, "Not Found", None, false)
    );
    assert_eq!(
        route(&front("GET", "/_hyper/keep", html), false)?,
        refused(405, "Method Not Allowed", Some("POST"), false)
    );
    assert_eq!(
        route(&front("POST", "/_hyper/keep", html), false)?,
        Route::Keep
    );
    assert_eq!(
        route(&front("GET", "/list", "image/png"), false)?,
        refused(406, "text/html\napplication/vnd.hyper+json\n", None, true)
    );
    assert_eq!(
        route(&front("GET", "/list", "text/html;q=2"), false)?,
        refused(400, "Bad Request", None, true)
    );
    let bad_hash = Front {
        context_header: Some(b"x".to_vec()),
        ..front("GET", "/list", html)
    };
    assert_eq!(
        route_request(&with_context, false, &bad_hash)?,
        refused(400, "Bad Request", None, false)
    );
    // A chosen request: the data base path answers JSON and no page (HY-62.19, HY-62.20), and outside it the shell.
    assert_eq!(
        route(&front("GET", "/_props/list", html), true)?,
        refused(406, "Not Acceptable", None, true)
    );
    assert_eq!(
        route(&front("GET", "/_props/list", json), true)?,
        page("list", PageKind::DocumentJson, false)
    );
    assert_eq!(
        route(&front("GET", "/_props/list", "application/xml"), true)?,
        refused(406, "application/vnd.hyper+json\n", None, true)
    );
    assert_eq!(
        route(&front("DELETE", "/_props/list", html), true)?,
        refused(405, "Method Not Allowed", Some("GET, HEAD"), false)
    );
    assert_eq!(route(&front("GET", "/list", html), true)?, Route::Shell);
    // An application under a base path routes no path outside it (HY-8.2).
    let under = board_under(false, "/app");
    assert_eq!(
        route_request(&under, false, &front("GET", "/list", html))?,
        refused(404, "Not Found", None, false)
    );
    assert_eq!(
        route_request(&under, false, &front("GET", "/app/list", html))?,
        page("list", PageKind::Html, false)
    );
    Ok(())
}

#[test]
fn the_headers_of_a_page_and_the_kept_endpoint() {
    // HY-53, HY-52, HY-65, HY-117.1, HY-45, HY-40.1
    use polyspec_hyper::front::{frame_headers, kept_value, page_headers, PageResponse};
    let response =
        |status: u16, json: bool, method: &str, if_none_match: Option<&str>| PageResponse {
            status,
            json,
            body: r#"{"shared":{"csrf":"masked"}}"#.to_owned(),
            cache_control: Some("private, max-age=60".to_owned()),
            context: false,
            masked_token: "masked".to_owned(),
            token: "token".to_owned(),
            method: method.to_owned(),
            if_none_match: if_none_match.map(str::to_owned),
        };
    let ok = page_headers(&response(200, true, "GET", None));
    assert_eq!(ok.status, 200);
    let names: Vec<&str> = ok.headers.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["Content-Type", "Cache-Control", "Vary", "ETag"]);
    let tag = ok.headers[3].1.clone();
    assert_eq!(
        tag,
        polyspec_hyper::etag::page_tag(r#"{"shared":{"csrf":"token"}}"#, "", "")
    );
    let not_modified = page_headers(&response(200, true, "GET", Some(&tag)));
    assert_eq!(not_modified.status, 304);
    assert!(!not_modified.body);
    assert!(not_modified
        .headers
        .iter()
        .all(|(name, _)| name != "Content-Type"));
    // An action runs whatever tag its request names (HY-53.4).
    assert_eq!(
        page_headers(&response(200, true, "POST", Some(&tag))).status,
        200
    );
    let failed = page_headers(&response(422, false, "POST", None));
    assert_eq!(
        failed.headers[1],
        ("Cache-Control".to_owned(), "no-store".to_owned())
    );
    assert_eq!(failed.headers.len(), 3);
    assert_eq!(
        frame_headers(403, "'self'"),
        [
            (
                "Content-Security-Policy".to_owned(),
                "frame-ancestors 'self'".to_owned()
            ),
            ("Cache-Control".to_owned(), "no-store".to_owned())
        ]
    );
    let pages = board(false);
    assert_eq!(
        kept_value(&pages, "rows", "open", "true"),
        Some(polyspec_template::Value::Bool(true))
    );
    assert_eq!(kept_value(&pages, "rows", "mode", "\"b\""), None);
    assert_eq!(kept_value(&pages, "rows", "open", "{"), None);
    assert_eq!(
        kept_value(&pages, "rows", "open", &format!("\"{}\"", "a".repeat(4095))),
        None
    );
    assert_eq!(kept_value(&pages, "nowhere", "open", "true"), None);
}

#[test]
fn the_session_of_a_page_and_of_the_kept_endpoint() -> Result<(), binding_core::Failure<Error>> {
    // HY-120.6, HY-120.7, HY-24.1, HY-24.4, HY-25.2, HY-59.8, HY-40.1, HY-11.3
    use polyspec_hyper::opening::{keep_request, open_page, KeepRequest, Opened, Opening};
    use polyspec_hyper::session::{kept, put_flash, token};
    use polyspec_hyper::steps::PageKind;
    use polyspec_session_store::MemoryStore;
    let pages = board(false);
    let mask = "ab".repeat(32);
    let opening = |action: bool, form_csrf: Option<String>| Opening {
        route: "list".to_owned(),
        params: Vec::new(),
        kind: PageKind::Html,
        action,
        path: "/list".to_owned(),
        base_path: String::new(),
        current_url: Some(b"http://host.example/other".to_vec()),
        keep_cookie: None,
        held_hash: None,
        form_csrf,
        mask: mask.clone(),
        now: 0.0,
    };
    let mut store = MemoryStore::new();
    let mut flash = polyspec_template::OrderedMap::new();
    flash.insert("note".to_owned(), polyspec_template::Value::text("added"));
    put_flash(&mut store, &flash, &["count".to_owned()])?;
    let Opened::Page {
        input,
        flash,
        token: first,
    } = open_page(&pages, &mut store, &opening(false, None))?
    else {
        panic!("a GET page is refused");
    };
    assert_eq!(first.len(), 64);
    assert_eq!(
        input.csrf,
        polyspec_hyper::csrf::mask(&first, &mask).map_err(binding_core::Failure::Kind)?
    );
    assert_eq!(input.changed, ["count", "path"]);
    assert!(input
        .stored
        .get("rows")
        .is_some_and(|paths| paths.is_empty()));
    assert!(flash.get("note").is_some());
    // The flash data belongs to the next request alone, and the token stays (HY-25.2, HY-24.1).
    let Opened::Page {
        input,
        flash,
        token: second,
    } = open_page(&pages, &mut store, &opening(false, None))?
    else {
        panic!("a GET page is refused");
    };
    assert!(flash.is_empty());
    assert_eq!(input.changed, ["path"]);
    assert_eq!(second, first);
    // A POST without the masked token is refused with 403, one with it opens the page (HY-24.4, HY-59.8).
    match open_page(&pages, &mut store, &opening(true, None))? {
        Opened::Refused { answer } => assert_eq!(answer.status, 403),
        Opened::Page { .. } => panic!("a POST without its token opened the page"),
    }
    let masked = polyspec_hyper::csrf::mask(&first, &mask).map_err(binding_core::Failure::Kind)?;
    assert!(matches!(
        open_page(&pages, &mut store, &opening(true, Some(masked.clone())))?,
        Opened::Page { .. }
    ));
    // The kept endpoint (HY-40.1).
    let keep = |csrf: &str, path: &str, value: &str| KeepRequest {
        form_csrf: Some(csrf.to_owned()),
        region: "rows".to_owned(),
        path: path.to_owned(),
        value: value.to_owned(),
    };
    assert_eq!(
        keep_request(&pages, &mut store, &keep("x", "open", "true"))?.status,
        403
    );
    assert_eq!(
        keep_request(&pages, &mut store, &keep(&masked, "mode", "\"b\""))?.status,
        400
    );
    assert_eq!(
        keep_request(&pages, &mut store, &keep(&masked, "open", "true"))?.status,
        204
    );
    assert_eq!(
        kept(&mut store, "rows")?.get("open"),
        Some(&polyspec_template::Value::Bool(true))
    );
    assert_eq!(token(&mut store)?, first);
    // The kept endpoint leaves the flash data to the next page request (HY-120.7).
    put_flash(
        &mut store,
        &polyspec_template::OrderedMap::new(),
        &["count".to_owned()],
    )?;
    assert_eq!(
        keep_request(&pages, &mut store, &keep(&masked, "open", "false"))?.status,
        204
    );
    let Opened::Page { input, .. } = open_page(&pages, &mut store, &opening(false, None))? else {
        panic!("a GET page is refused");
    };
    assert_eq!(input.changed, ["count", "path"]);
    Ok(())
}

/// The bytes of a hexadecimal text of a case.
fn hex_bytes(text: &str) -> Vec<u8> {
    let digits: Vec<u32> = text
        .chars()
        .map(|ch| match ch.to_digit(16) {
            Some(digit) => digit,
            None => panic!("{text}: not hexadecimal"),
        })
        .collect();
    digits
        .chunks(2)
        .map(|pair| match pair {
            [high, low] => match u8::try_from(high * 16 + low) {
                Ok(byte) => byte,
                Err(error) => panic!("{error}"),
            },
            _ => panic!("{text}: an odd number of digits"),
        })
        .collect()
}

#[test]
fn the_build_id_of_the_files_of_a_build() {
    // HY-125.3, HY-125.15, HY-125.17, HY-125.18
    use polyspec_hyper::build::{file_text, hashed, id, stream, Output};
    let file = cases("context.json");
    let mut ran = 0;
    for case in group(&file, "builds") {
        let outputs: Vec<Output> = case["files"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|file| Output {
                path: text(file, "path").to_owned(),
                bytes: text(file, "content").as_bytes().to_vec(),
            })
            .collect();
        let sorted = match hashed(&outputs) {
            Ok(files) => files
                .iter()
                .map(|file| Value::from(file.path.clone()))
                .collect::<Vec<_>>(),
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        assert_eq!(Value::Array(sorted), case["sortedPaths"], "{}", case["id"]);
        if let Some(expected) = case.get("stream").and_then(Value::as_str) {
            match stream(&outputs) {
                Ok(bytes) => assert_eq!(
                    polyspec_hyper::csrf::to_hex(&bytes),
                    expected,
                    "{}",
                    case["id"]
                ),
                Err(error) => panic!("{}: {error}", case["id"]),
            }
        }
        let build = match id(&outputs) {
            Ok(build) => build,
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        assert_eq!(build, text(case, "build"), "{}", case["id"]);
        match file_text(&build) {
            Ok(written) => assert_eq!(
                written,
                text(&case["excluded"][0], "content"),
                "{}",
                case["id"]
            ),
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn a_build_file_holds_a_build_id() {
    // HY-125.18, HY-125.19
    use polyspec_hyper::build::read;
    let file = cases("build.json");
    let mut ran = 0;
    for case in group(&file, "read") {
        let bytes = match (
            case["text"].as_str(),
            case.get("bytes").and_then(Value::as_str),
        ) {
            (Some(text), _) => text.as_bytes().to_vec(),
            (None, Some(hex)) => hex_bytes(hex),
            // A missing file is the open of a host, which reads the file.
            (None, None) => continue,
        };
        match read(&bytes) {
            Ok(build) => assert_eq!(build, text(case, "build"), "{}", case["id"]),
            Err(error) => {
                assert!(case.get("raises").is_some(), "{}: {error}", case["id"]);
                check_raises(case, &error);
            }
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn the_template_check_of_an_application() {
    // HY-48.3, HY-48.13, HC-6, HY-3, HY-30, HY-75, HY-125.7
    use polyspec_hyper::steps::Map;
    use polyspec_hyper::template_rules::problems;
    let file = cases("manifest.json");
    let mut ran = 0;
    for case in group(&file, "templateChecks") {
        let mut templates = Map::new();
        for (name, source) in case["templates"].as_object().into_iter().flatten() {
            templates.insert(name.clone(), text_of(source).to_owned());
        }
        match problems(case["manifest"].to_string().as_bytes(), &templates) {
            Ok(found) => {
                let found: Vec<Value> = found.into_iter().map(Value::from).collect();
                assert_eq!(Value::Array(found), case["problems"], "{}", case["id"]);
            }
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

/// The templates of a case: a map from template names to their sources.
fn templates_of(case: &Value, key: &str) -> polyspec_hyper::steps::Map<String> {
    let mut templates = polyspec_hyper::steps::Map::new();
    for (name, source) in case[key].as_object().into_iter().flatten() {
        templates.insert(name.clone(), text_of(source).to_owned());
    }
    templates
}

#[test]
fn the_read_paths_of_a_template() {
    // HY-73.2 to HY-73.17
    use polyspec_hyper::read_paths::template_reads;
    let file = cases("reads.json");
    let mut ran = 0;
    for case in group(&file, "cases") {
        match template_reads(&templates_of(case, "templates"), text(case, "template")) {
            // The order of the keys is that of HY-73.32, which the text of the case holds.
            Ok(reads) => assert_eq!(
                as_json(&reads).to_string(),
                case["reads"].to_string(),
                "{}",
                case["id"]
            ),
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn the_read_paths_of_the_routes() {
    // HY-73.18, HY-73.19, HY-73.23, HY-73.32
    use polyspec_hyper::read_paths::route_reads;
    use polyspec_hyper::steps::route_reads as from_build;
    let file = cases("reads.json");
    let mut ran = 0;
    for case in group(&file, "routes") {
        let manifest = case["manifest"].to_string();
        match route_reads(manifest.as_bytes(), &templates_of(case, "templates")) {
            Ok(routes) => {
                // The order of the routes, the regions and the keys is that of HY-73.32, which the text of the case holds.
                assert_eq!(
                    as_json(&routes).to_string(),
                    case["routes"].to_string(),
                    "{}",
                    case["id"]
                );
                // The pages read the value as the build writes it (HY-73.23).
                if let Err(error) = from_build(&routes) {
                    panic!("{}: {error}", case["id"]);
                }
            }
            Err(error) => panic!("{}: {error}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
}

#[test]
fn the_reserved_template_of_the_embedded_data() {
    // HY-31.3, HY-31.9
    use polyspec_hyper::render::data_template;
    let file = cases("build.json");
    let mut ran = 0;
    for case in group(&file, "dataTemplate") {
        let template = data_template();
        assert_eq!(template.name, text(case, "name"), "{}", case["id"]);
        assert_eq!(template.source, text(case, "source"), "{}", case["id"]);
        ran += 1;
    }
    assert!(ran > 0);
}

/// A value in the case form of binding (G-5: `{"kind", "value"}`, a map as pairs) as JSON text of the data model.
fn case_value_json(value: &Value) -> Value {
    match (text(value, "kind"), value.get("value")) {
        ("null", None) => Value::Null,
        ("bool" | "float" | "text", Some(scalar)) => scalar.clone(),
        ("list", Some(Value::Array(items))) => {
            Value::Array(items.iter().map(case_value_json).collect())
        }
        ("map", Some(Value::Array(pairs))) => Value::Object(
            pairs
                .iter()
                .map(|pair| (text_of(&pair[0]).to_owned(), case_value_json(&pair[1])))
                .collect(),
        ),
        _ => panic!("no case value: {value}"),
    }
}

/// Calls a member under the faults that a case arms, as a generated binding test does (binding design G-5): it arms the
/// list for the member, the call takes the arming as the entry point of the member does, and a fault that did not fire
/// fails the case.
fn armed<T>(case: &Value, member: &str, call: impl FnOnce() -> T) -> T {
    let id = match binding_core::fault::arm(member, &case["faults"].to_string()) {
        Ok(id) => id,
        Err(error) => panic!("{}: {error}", case["id"]),
    };
    let outcome = binding_core::fault::take(member).run(call);
    match binding_core::fault::left(id) {
        Ok(left) => assert!(
            left.is_empty(),
            "{}: the faults of {} did not fire",
            case["id"],
            left.join(", ")
        ),
        Err(error) => panic!("{}: {error}", case["id"]),
    }
    outcome
}

#[test]
fn the_fault_cases_raise_their_kind_where_their_points_break() -> Result<(), Error> {
    // HY-132.6; binding design G-5, X-1. Each case of the group internal of tests/cases/faults.json arms a point for
    // front_functions.route_request and raises internal; the same call without the arming routes to the page home,
    // because a point that no case armed breaks nothing.
    use polyspec_hyper::front::{route_request, Front, Route};
    use polyspec_hyper::steps::PageKind;
    let file = fault_cases();
    let mut ran = 0;
    for case in group(&file, "internal") {
        let pages = case_pages(case)?;
        let front = &case["front"];
        let accept = front["accept"].as_array().into_iter().flatten();
        let request = Front {
            method: text(front, "method").to_owned(),
            path: text(front, "path").to_owned(),
            accept: accept.map(|line| from_hex(text(line, "hex"))).collect(),
            hx_request: front["hx_request"] == Value::Bool(true),
            context_header: front["context_header"].as_str().map(latin1),
            media_type: front["media_type"].as_str().map(str::to_owned),
            malformed_content_type: front["malformed_content_type"] == Value::Bool(true),
        };
        let chosen = case["chosen"] == Value::Bool(true);
        let member = "front_functions.route_request";
        match armed(case, member, || route_request(&pages, chosen, &request)) {
            Ok(route) => panic!("{}: {route:?}", case["id"]),
            Err(error) => check_raises(case, &error),
        }
        assert_eq!(
            route_request(&pages, chosen, &request)?,
            Route::Page {
                route: "home".to_owned(),
                params: Vec::new(),
                kind: PageKind::Html,
                action: false,
            },
            "{}",
            case["id"]
        );
        ran += 1;
    }
    assert!(ran > 0);
    Ok(())
}

#[test]
fn the_fault_cases_of_the_template_raise_internal_where_the_parser_breaks() -> Result<(), Error> {
    // HY-132.6, HY-73.2; binding design G-5, X-1. A case of the group template of tests/cases/faults.json that arms
    // template.internal for rules.template_reads parses a template with an else-if branch and raises internal; the same
    // call without the arming gives the read paths of both tests, because the parser finds the open block of the branch.
    // A case without faults raises its kind without any arming.
    use polyspec_hyper::read_paths::template_reads;
    use polyspec_hyper::steps::Map;
    let file = fault_cases();
    let mut ran = 0;
    for case in group(&file, "template") {
        let mut templates = Map::new();
        for pair in case["templates"].as_array().into_iter().flatten() {
            templates.insert(text_of(&pair[0]).to_owned(), text_of(&pair[1]).to_owned());
        }
        let name = text(case, "name");
        if case.get("faults").is_none() {
            check(case, &template_reads(&templates, name), |_| ());
            ran += 1;
            continue;
        }
        match armed(case, "rules.template_reads", || {
            template_reads(&templates, name)
        }) {
            Ok(reads) => panic!("{}: {reads:?}", case["id"]),
            Err(error) => check_raises(case, &error),
        }
        let reads = as_json(&template_reads(&templates, name)?);
        for test in ["a", "b"] {
            assert_eq!(
                reads["keys"][test],
                Value::Bool(true),
                "{}: {test} is no read path of {reads}",
                case["id"]
            );
        }
        ran += 1;
    }
    assert!(ran > 0);
    Ok(())
}

/// The store of a case of opening_functions.open_page, given as an instance value (binding GN-13f): a memory store with
/// the values that its calls of `memory_store.set` give as PHP serialization, or the session of a file store that
/// `file_sessions.open` opens without a cookie.
fn case_store(case: &Value) -> Box<dyn polyspec_session_store::Store> {
    use polyspec_session_store::{FileSessions, MemoryStore, Store};
    let store = &case["store"];
    match text(store, "new") {
        "memory_store.new" => {
            let mut memory = MemoryStore::new();
            for call in store["then"].as_array().into_iter().flatten() {
                assert_eq!(text(call, "call"), "memory_store.set", "{}", case["id"]);
                let args = &call["args"];
                let value =
                    match polyspec_php_serialization::unserialize(text(args, "value").as_bytes()) {
                        Ok(value) => value,
                        Err(error) => panic!("{}: {error}", case["id"]),
                    };
                if let Err(error) = memory.set(text(args, "key"), &value) {
                    panic!("{}: {error}", case["id"]);
                }
            }
            Box::new(memory)
        }
        "file_sessions.open" => {
            let receiver = &store["receiver"];
            assert_eq!(text(receiver, "new"), "file_sessions.new", "{}", case["id"]);
            assert_eq!(store["args"]["cookie"], Value::Null, "{}", case["id"]);
            let args = &receiver["args"];
            let sessions = match FileSessions::new(
                binding_core::Io::for_generated_call(),
                std::path::Path::new(text(args, "directory")),
                args["lifetime"].as_u64(),
            ) {
                Ok(sessions) => sessions,
                Err(error) => panic!("{}: {error}", case["id"]),
            };
            match sessions.open(binding_core::ProcessWait::for_generated_call(), None, None) {
                Ok(session) => Box::new(session),
                Err(error) => panic!("{}: {error}", case["id"]),
            }
        }
        other => panic!("{}: no store of {other}", case["id"]),
    }
}

/// The cases of tests/cases/faults.json.
fn fault_cases() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/cases/faults.json");
    match fs::read_to_string(&path).map(|text| serde_json::from_str(&text)) {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => panic!("{}: {error}", path.display()),
        Err(error) => panic!("{}: {error}", path.display()),
    }
}

/// The pages of a case that gives them as `{"new": "pages.open", "args": ...}`.
fn case_pages(case: &Value) -> Result<polyspec_hyper::steps::Pages, Error> {
    use polyspec_hyper::steps::{Map, Pages, PagesOptions};
    let pages = &case["pages"];
    assert_eq!(text(pages, "new"), "pages.open", "{}", case["id"]);
    let args = &pages["args"];
    let mut templates = Map::new();
    for pair in args["templates"].as_array().into_iter().flatten() {
        templates.insert(text_of(&pair[0]).to_owned(), text_of(&pair[1]).to_owned());
    }
    let options = &args["options"];
    let forms = options["form_types"].as_array().into_iter().flatten();
    Pages::open(
        &from_hex(text(&args["manifest"], "hex")),
        &templates,
        &data_value(&case_value_json(&args["reads"]).to_string())?,
        &PagesOptions {
            build: text(options, "build").to_owned(),
            timezone: text(options, "timezone").to_owned(),
            context: options["context"] == Value::Bool(true),
            base_path: text(options, "base_path").to_owned(),
            data_base_path: options["data_base_path"].as_str().map(str::to_owned),
            form_types: forms.map(|form| text_of(form).to_owned()).collect(),
        },
    )
}

#[test]
fn the_session_cases_of_a_page_raise_their_kinds() -> Result<(), Error> {
    // HY-132.6, HY-24.14, HY-104.23; binding design G-5, X-1. The case of the group session of tests/cases/faults.json
    // that arms session_store.internal for opening_functions.open_page opens a page with a file session that found
    // no record, whose first get starts the record session, and raises internal; the same call without the arming
    // opens the page with a new token, because the start of the session leaves it started. Its other cases raise the
    // kinds that their stored values or their mask give.
    use binding_core::Failure;
    use polyspec_hyper::opening::{open_page, Opened, Opening};
    use polyspec_hyper::steps::PageKind;
    let file = fault_cases();
    let mut ran = 0;
    for case in group(&file, "session") {
        let pages = case_pages(case)?;
        let given = &case["opening"];
        assert_eq!(text(given, "kind"), "html", "{}", case["id"]);
        let opening = Opening {
            route: text(given, "route").to_owned(),
            params: Vec::new(),
            kind: PageKind::Html,
            action: given["action"] == Value::Bool(true),
            path: text(given, "path").to_owned(),
            base_path: text(given, "base_path").to_owned(),
            current_url: given["current_url"].as_str().map(latin1),
            keep_cookie: given["keep_cookie"].as_str().map(str::to_owned),
            held_hash: given["held_hash"].as_str().map(str::to_owned),
            form_csrf: given["form_csrf"].as_str().map(str::to_owned),
            mask: text(given, "mask").to_owned(),
            now: match given["now"].as_f64() {
                Some(now) => now,
                None => panic!("{}: now is no number", case["id"]),
            },
        };
        let raised = |result: Result<Opened, Failure<Error>>| match result {
            Ok(opened) => panic!("{}: {opened:?}", case["id"]),
            Err(Failure::Kind(error)) => check_raises(case, &error),
            Err(other) => panic!("{}: {other:?}", case["id"]),
        };
        if case.get("faults").is_none() {
            let mut store = case_store(case);
            raised(open_page(&pages, store.as_mut(), &opening));
            ran += 1;
            continue;
        }
        let mut store = case_store(case);
        raised(armed(case, "opening_functions.open_page", || {
            open_page(&pages, store.as_mut(), &opening)
        }));
        let mut store = case_store(case);
        match open_page(&pages, store.as_mut(), &opening) {
            Ok(Opened::Page { token, .. }) => assert_eq!(token.len(), 64, "{}", case["id"]),
            other => panic!("{}: {other:?}", case["id"]),
        }
        ran += 1;
    }
    assert!(ran > 0);
    Ok(())
}
