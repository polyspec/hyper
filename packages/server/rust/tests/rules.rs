//! The rules of this crate that no contract case states alone: the 406 listing, the representation entry and its
//! response, the session cookie, the tags, the answers of the ORM and the order of a request.

use bindgen_core::Kinds;
use polyspec_hyper::media::{
    content_type, listing, page_vary, representation_vary, select, Selected, Selection, Served,
};
use polyspec_hyper::orm::{answer, Escape, OrmAnswer};
use polyspec_hyper::pipeline::{opens_session, Step, ORDER};
use polyspec_hyper::representation::{
    allow, answers, body_check, entries, entry, response, BodyCheck, Entry,
};
use polyspec_hyper::{cookies, etag, Error};

fn post_entry() -> Result<Entry, Error> {
    entry(
        "application/vnd.example.post+json",
        &[("version".to_owned(), vec!["1".to_owned(), "2".to_owned()])],
        &["GET".to_owned(), "PUT".to_owned(), "DELETE".to_owned()],
        &[],
    )
}

fn json_entry() -> Result<Entry, Error> {
    entry(
        "application/json",
        &[],
        &["GET".to_owned()],
        &["Authorization".to_owned()],
    )
}

#[test]
fn a_406_lists_every_served_type_and_combination() -> Result<(), Error> {
    // HY-116.13, HY-119.4: the body of the representations case a_parameter_after_q_is_an_accept_extension before
    // HY-116.18 made it a 400.
    let body = listing(
        Served {
            page: true,
            page_data: true,
        },
        &[post_entry()?, json_entry()?],
    )?;
    assert_eq!(
        String::from_utf8_lossy(&body),
        "text/html\napplication/vnd.hyper+json\napplication/vnd.example.post+json; version=1\napplication/vnd.example.post+json; version=2\napplication/json\n"
    );
    Ok(())
}

#[test]
fn a_declared_type_takes_the_values_of_its_deciding_range() -> Result<(), Error> {
    // HY-116.19, HY-119.5
    let entries = [post_entry()?, json_entry()?];
    let lines =
        vec![b"text/html;q=0.5, application/vnd.example.post+json;version=\"2\";q=0.9".to_vec()];
    let selected = select(
        &lines,
        Served {
            page: true,
            page_data: true,
        },
        &entries,
    )?;
    assert_eq!(
        selected,
        Selection::Selected(Selected::Representation {
            entry: 0,
            values: vec![b"2".to_vec()]
        })
    );
    let written = content_type(&entries[0], &[b"2".to_vec()])?;
    assert_eq!(written, b"application/vnd.example.post+json; version=2");
    // A range without the required parameter and a wildcard give the declared type no weight (HY-116.19).
    let lines = vec![b"application/vnd.example.post+json, application/*".to_vec()];
    let selected = select(
        &lines,
        Served {
            page: false,
            page_data: false,
        },
        &entries,
    )?;
    assert!(matches!(selected, Selection::NotAcceptable { .. }));
    Ok(())
}

#[test]
fn an_accept_extension_is_a_bad_request() {
    // HY-116.18
    let lines = vec![b"application/vnd.example.post+json;q=0.5;version=2".to_vec()];
    match select(
        &lines,
        Served {
            page: true,
            page_data: true,
        },
        &[],
    ) {
        Err(error) => {
            assert_eq!(error.kind(), "invalid_accept");
            assert_eq!(error.status(), Some(400));
        }
        Ok(selection) => panic!("{selection:?}"),
    }
}

#[test]
fn equal_weights_keep_the_order_of_the_types() -> Result<(), Error> {
    // HY-116.11
    let lines = vec![b"application/vnd.hyper+json, text/html".to_vec()];
    assert_eq!(
        select(
            &lines,
            Served {
                page: true,
                page_data: true
            },
            &[]
        )?,
        Selection::Selected(Selected::Page)
    );
    Ok(())
}

#[test]
fn the_manifest_check_refuses_entries() {
    // HY-118.5, HY-118.6
    let refused = [
        entry("text/html", &[], &["GET".to_owned()], &[]),
        entry("Application/Vnd.Hyper+JSON", &[], &["GET".to_owned()], &[]),
        entry("application/*", &[], &["GET".to_owned()], &[]),
        entry(
            "application/json",
            &[("Q".to_owned(), vec!["1".to_owned()])],
            &["GET".to_owned()],
            &[],
        ),
        entry(
            "application/json",
            &[("v".to_owned(), vec![])],
            &["GET".to_owned()],
            &[],
        ),
        entry(
            "application/json",
            &[("v".to_owned(), vec!["\u{e9}".to_owned()])],
            &["GET".to_owned()],
            &[],
        ),
        entry("application/json", &[], &[], &[]),
        entry("application/json", &[], &["PATCH".to_owned()], &[]),
        entry(
            "application/json",
            &[],
            &["GET".to_owned()],
            &["Cookie".to_owned()],
        ),
        entry(
            "application/json",
            &[],
            &["GET".to_owned()],
            &["X-A".to_owned(), "x-a".to_owned()],
        ),
    ];
    for result in refused {
        match result {
            Err(error) => assert_eq!(error.kind(), "invalid_application"),
            Ok(entry) => panic!("{entry:?}"),
        }
    }
    let twice = match (
        json_entry(),
        entry("Application/JSON", &[], &["GET".to_owned()], &[]),
    ) {
        (Ok(first), Ok(second)) => entries(vec![first, second]),
        other => panic!("{other:?}"),
    };
    assert!(matches!(twice, Err(Error::InvalidApplication(_))));
}

#[test]
fn methods_and_bodies_of_a_representation() -> Result<(), Error> {
    // HY-121.6, HY-118.3, HY-121.7, HY-121.11
    let post = post_entry()?;
    assert_eq!(allow(&post), "GET, HEAD, PUT, DELETE");
    assert!(answers(&post, "HEAD"));
    assert!(!answers(&post, "POST"));
    assert_eq!(body_check("GET", 0, None), BodyCheck::Run { json: false });
    assert_eq!(body_check("DELETE", 3, None), BodyCheck::BadRequest);
    assert_eq!(body_check("PUT", 3, None), BodyCheck::UnsupportedMediaType);
    assert_eq!(
        body_check("PUT", 3, Some(b"text/plain")),
        BodyCheck::UnsupportedMediaType
    );
    assert_eq!(
        body_check("PUT", 3, Some(b"Application/JSON; charset=utf-8")),
        BodyCheck::Run { json: true }
    );
    assert_eq!(body_check("PUT", 3, Some(b"")), BodyCheck::BadRequest);
    Ok(())
}

#[test]
fn the_response_of_a_representation_handler() -> Result<(), Error> {
    // HY-122.2 to HY-122.8
    let checked = response(200, true, &[], false, "/base")?;
    assert_eq!(
        checked.headers,
        vec![("Cache-Control".to_owned(), "no-cache".to_owned())]
    );
    let checked = response(200, true, &[], true, "/base")?;
    assert_eq!(
        checked.headers,
        vec![("Cache-Control".to_owned(), "private, no-cache".to_owned())]
    );
    let checked = response(
        201,
        false,
        &[("location".to_owned(), "/posts/8".to_owned())],
        false,
        "/base",
    )?;
    assert_eq!(
        checked.headers[1],
        ("Location".to_owned(), "/base/posts/8".to_owned())
    );
    let checked = response(
        201,
        false,
        &[("Location".to_owned(), "https://example.com/x".to_owned())],
        false,
        "",
    )?;
    assert_eq!(
        checked.headers[1],
        ("Location".to_owned(), "https://example.com/x".to_owned())
    );
    let refused = [
        response(500, true, &[], false, ""),
        response(401, true, &[], false, ""),
        response(201, true, &[], false, ""),
        response(204, true, &[], false, ""),
        response(200, false, &[], false, ""),
        response(
            200,
            true,
            &[("Set-Cookie".to_owned(), "a=b".to_owned())],
            false,
            "",
        ),
        response(
            404,
            true,
            &[("Cache-Control".to_owned(), "no-cache".to_owned())],
            false,
            "",
        ),
        response(
            200,
            true,
            &[("Cache-Control".to_owned(), "public, max-age=60".to_owned())],
            true,
            "",
        ),
        response(
            201,
            false,
            &[("Location".to_owned(), "//host/path".to_owned())],
            false,
            "",
        ),
        response(
            201,
            false,
            &[("Location".to_owned(), "posts/8".to_owned())],
            false,
            "",
        ),
    ];
    for result in refused {
        match result {
            Err(error) => assert_eq!(error.kind(), "invalid_representation"),
            Ok(checked) => panic!("{checked:?}"),
        }
    }
    Ok(())
}

#[test]
fn vary_names_the_headers_that_decide_a_response() -> Result<(), Error> {
    // HY-117.1, HY-117.2
    assert_eq!(page_vary(false), "Accept, HX-Request, HX-Current-URL");
    assert_eq!(
        page_vary(true),
        "Accept, HX-Request, HX-Current-URL, Hyper-Context"
    );
    assert_eq!(representation_vary(&json_entry()?), "Accept, Authorization");
    Ok(())
}

#[test]
fn the_session_cookie_and_the_names_of_hyper() -> Result<(), Error> {
    // HY-45.1, HY-45.8, HY-38.10; the cases of contracts/file-sessions.json group cookie
    let identifier = "a".repeat(64);
    assert_eq!(
        cookies::session_cookie(&identifier, false)?,
        format!("hy-session={identifier}; Path=/; HttpOnly; SameSite=Lax").into_bytes()
    );
    assert_eq!(
        cookies::session_cookie(&identifier, true)?,
        format!("__Host-hy-session={identifier}; Path=/; Secure; HttpOnly; SameSite=Lax")
            .into_bytes()
    );
    assert_eq!(cookies::keep_name(true), "__Host-hy-keep");
    let parsed = vec![
        ("hy-keep".to_owned(), "1".to_owned()),
        ("hy-keep".to_owned(), "2".to_owned()),
    ];
    assert_eq!(cookies::find(&parsed, "hy-keep"), Some("1"));
    Ok(())
}

#[test]
fn page_tags_replace_the_masked_token() {
    // HY-53.1, HY-53.2
    let first = etag::page_tag("{\"csrf\":\"m1\",\"a\":1}", "m1", "t");
    let second = etag::page_tag("{\"csrf\":\"m2\",\"a\":1}", "m2", "t");
    assert_eq!(first, second);
    assert!(first.starts_with("W/\"") && first.len() == 36);
    assert!(etag::not_modified(Some(&first), &first));
    assert!(!etag::not_modified(None, &first));
}

#[test]
fn errors_of_the_orm_are_answered_by_their_kind() {
    // HY-107.7 to HY-107.9, HY-122.12
    assert_eq!(answer("no_rows", Escape::Loader), OrmAnswer::NotFound);
    assert_eq!(
        answer("revision_changed", Escape::Action),
        OrmAnswer::ConflictPage
    );
    assert_eq!(
        answer("revision_changed", Escape::Loader),
        OrmAnswer::Unhandled
    );
    assert_eq!(
        answer("revision_changed", Escape::Representation),
        OrmAnswer::PreconditionFailed
    );
    assert_eq!(answer("driver", Escape::Action), OrmAnswer::Unhandled);
}

#[test]
fn a_refused_request_opens_no_session() {
    // HY-120.1 to HY-120.4
    let open = ORDER.iter().position(|step| *step == Step::OpenSession);
    for step in [
        Step::Route,
        Step::MediaType,
        Step::Method,
        Step::Context,
        Step::FormType,
    ] {
        assert!(ORDER.iter().position(|other| *other == step) < open);
    }
    assert!(opens_session(false, Some(&Selected::Page)));
    assert!(opens_session(true, None));
    assert!(!opens_session(
        false,
        Some(&Selected::Representation {
            entry: 0,
            values: Vec::new()
        })
    ));
}

#[test]
fn errors_name_their_kind_and_category() {
    // HY-132.1 to HY-132.3
    assert_eq!(Error::NotApplicationPath.category().as_str(), "value");
    assert_eq!(Error::NotSelected.category().as_str(), "type");
    assert_eq!(Error::InvalidSessionRecord.category().as_str(), "store");
    assert_eq!(Error::Internal("x").kind(), "internal");
    assert_eq!(Error::InvalidSessionToken.errno(), None);
}
