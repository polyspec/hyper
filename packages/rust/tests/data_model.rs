//! The data model check of a page (HY-44.3, HY-44.6, HY-44.10 to HY-44.12): the steps of a page check every value that
//! the context handler, the shared handler, the loaders and the action return in the step that receives it, before
//! the read paths remove the values that no template reads (HY-73.29), so a value outside the data model fails the
//! page also when no template reads it, with the kind of the template data model, and no later handler is asked for.

use binding_core::{Failure, Kinds};
use polyspec_hyper::steps::{
    ActionOutcome, Answer, Call, Input, Map, PageInput, PageKind, PageRequest, Pages, PagesOptions,
    Step,
};
use polyspec_hyper::Error;
use polyspec_template::{HostError, OrderedMap, TemplateObject, Value};

const MANIFEST: &str = concat!(
    r#"{"layout":"layout.tpl","title":"title.tpl","#,
    r#""regions":[{"name":"side","template":"side.tpl","uses":["count"]},{"name":"content","page":true}],"#,
    r#""routes":[{"name":"home","path":"/","title":"Home","template":"page.tpl","post":true}]}"#
);

/// The read paths of the route: of the shared data only `title`, of the region `side` only `count` and of the page
/// region only `name`, so every other key is a value that no template reads.
const READS: &str = concat!(
    r#"{"home":{"shared":{"keys":{"title":true}},"#,
    r#""regions":{"side":{"keys":{"count":true}},"content":{"keys":{"name":true}}}}}"#
);

/// An object of the application, which host binding keeps as a native object (VAL-19).
#[derive(Debug)]
struct Clock;

impl TemplateObject for Clock {
    fn member(&self, _key: &str) -> Result<Option<Value>, HostError> {
        Ok(None)
    }

    fn call(&self, _method: &str, _args: &[Value]) -> Option<Result<Value, HostError>> {
        None
    }
}

fn pages(context: bool) -> Pages {
    let mut templates = Map::new();
    for (name, source) in [
        (
            "layout.tpl",
            "<title>{# title}</title><aside>{# side}</aside><main>{# content}</main>{# data}",
        ),
        ("title.tpl", "{= title}"),
        ("side.tpl", "<b>{= count}</b>"),
        ("page.tpl", "<p>{= name}</p>"),
    ] {
        templates.insert(name.to_owned(), source.to_owned());
    }
    let reads = match polyspec_hyper::json::read(READS.as_bytes()) {
        Ok(reads) => reads,
        Err(error) => panic!("{error:?}"),
    };
    let options = PagesOptions {
        build: "1".repeat(64),
        timezone: "Z".to_owned(),
        context,
        base_path: String::new(),
        form_types: Vec::new(),
        data_base_path: None,
    };
    match Pages::open(MANIFEST.as_bytes(), &templates, &reads, &options) {
        Ok(pages) => pages,
        Err(error) => panic!("{error}"),
    }
}

fn input(kind: PageKind, action: bool) -> PageInput {
    PageInput {
        route: "home".to_owned(),
        params: Map::new(),
        kind,
        action,
        csrf: "t".to_owned(),
        changed: Vec::new(),
        now: 0.0,
        keep_cookie: None,
        held_hash: None,
    }
}

/// A map of the boundary with one entry.
fn entry(key: &str, value: Value) -> Map<Value> {
    let mut map = Map::new();
    map.insert(key.to_owned(), value);
    map
}

/// A list that nests one level deeper than the limit of VAL-20 inside the map that holds it.
fn deep() -> Value {
    let mut value = Value::Null;
    for _ in 0..polyspec_template::MAX_DEPTH {
        value = Value::list(vec![value]);
    }
    value
}

/// The reply of a page that embeds no data, with a session that stored no kept value.
fn reply() -> Input {
    Input::Reply {
        embeds: false,
        stored: Map::new(),
        status: None,
    }
}

/// Runs the steps of a page with the results of its calls in order: the calls that the page made and its answer or
/// its failure.
fn run(
    pages: &Pages,
    input: &PageInput,
    results: Vec<Input>,
) -> (Vec<Call>, Result<Answer, Failure<Error>>) {
    let mut page = match PageRequest::new(pages, input) {
        Ok(page) => page,
        Err(error) => panic!("{error}"),
    };
    let mut calls = Vec::new();
    let mut results = results.into_iter();
    let mut given = Input::Start;
    loop {
        match page.next(&given) {
            Ok(Step::Call { call }) => {
                calls.push(call);
                given = match results.next() {
                    Some(result) => result,
                    None => panic!("no result for {calls:?}"),
                };
            }
            Ok(Step::Answer { answer }) => return (calls, Ok(answer)),
            Err(failure) => return (calls, Err(failure)),
        }
    }
}

/// The kind of the failure of a page, which must be a kind of the data model.
fn kind(label: &str, result: Result<Answer, Failure<Error>>) -> &'static str {
    match result {
        Err(Failure::Kind(error @ Error::DataModel(_))) => error.kind(),
        Err(failure) => panic!("{label}: {failure:?}"),
        Ok(answer) => panic!("{label}: the page answered {answer:?}"),
    }
}

/// A map of a number of levels of maps: the innermost is empty, and every other holds the next under `m`.
fn nested(levels: usize) -> Value {
    let mut value = Value::map(OrderedMap::new());
    for _ in 1..levels {
        let mut map = OrderedMap::new();
        map.insert("m".to_owned(), value);
        value = Value::map(map);
    }
    value
}

/// The map that a handler returns, of a number of levels of maps, the returned map being level 1.
fn returned(levels: usize) -> Map<Value> {
    entry("m", nested(levels - 1))
}

#[test]
fn a_value_outside_the_data_model_fails_the_step_that_receives_it() {
    // HY-44.10: the step that receives the value fails, so the page asks for no later handler.
    let app = pages(false);
    let native = || entry("unread", Value::object(Clock));
    let (calls, result) = run(
        &app,
        &input(PageKind::Html, false),
        vec![
            Input::Shared { shared: native() },
            Input::NoHandler,
            Input::NoHandler,
            reply(),
        ],
    );
    assert_eq!(calls, [Call::Shared], "shared");
    assert_eq!(kind("shared", result), "data_unsupported_type");
    let (calls, result) = run(
        &app,
        &input(PageKind::Html, false),
        vec![
            Input::NoHandler,
            Input::Loaded { data: native() },
            Input::NoHandler,
            reply(),
        ],
    );
    assert_eq!(
        calls,
        [
            Call::Shared,
            Call::RegionLoader {
                region: "side".to_owned()
            }
        ],
        "region"
    );
    assert_eq!(kind("region", result), "data_unsupported_type");
    let (calls, result) = run(
        &app,
        &input(PageKind::Html, true),
        vec![
            Input::Action {
                outcome: ActionOutcome::Page {
                    status: 422,
                    data: native(),
                },
                csrf: None,
            },
            Input::NoHandler,
            Input::NoHandler,
            Input::NoHandler,
            reply(),
        ],
    );
    assert_eq!(calls, [Call::Action], "action");
    assert_eq!(kind("action", result), "data_unsupported_type");
}

#[test]
fn the_depth_of_a_value_counts_with_the_maps_that_hold_it() {
    // HY-44.11: the shared data and the context are one map below the counted root and the data of a region two, so
    // their maps nest 63 and 62 levels at most.
    let shared = |levels: usize| {
        run(
            &pages(false),
            &input(PageKind::DocumentJson, false),
            vec![
                Input::Shared {
                    shared: returned(levels),
                },
                Input::NoHandler,
                Input::NoHandler,
                reply(),
            ],
        )
        .1
    };
    assert!(shared(63).is_ok(), "shared 63");
    assert_eq!(kind("shared 64", shared(64)), "data_depth");
    let context = |levels: usize| {
        run(
            &pages(true),
            &input(PageKind::DocumentJson, false),
            vec![
                Input::Context {
                    context: returned(levels),
                },
                Input::NoHandler,
                Input::NoHandler,
                Input::NoHandler,
                reply(),
            ],
        )
        .1
    };
    assert!(context(63).is_ok(), "context 63");
    assert_eq!(kind("context 64", context(64)), "data_depth");
    let region = |levels: usize| {
        run(
            &pages(false),
            &input(PageKind::DocumentJson, false),
            vec![
                Input::NoHandler,
                Input::Loaded {
                    data: returned(levels),
                },
                Input::NoHandler,
                reply(),
            ],
        )
        .1
    };
    assert!(region(62).is_ok(), "region 62");
    assert_eq!(kind("region 63", region(63)), "data_depth");
    let route = |levels: usize| {
        run(
            &pages(false),
            &input(PageKind::DocumentJson, false),
            vec![
                Input::NoHandler,
                Input::NoHandler,
                Input::Loaded {
                    data: returned(levels),
                },
                reply(),
            ],
        )
        .1
    };
    assert!(route(62).is_ok(), "route 62");
    assert_eq!(kind("route 63", route(63)), "data_depth");
    let action = |levels: usize| {
        run(
            &pages(false),
            &input(PageKind::DocumentJson, true),
            vec![
                Input::Action {
                    outcome: ActionOutcome::Page {
                        status: 422,
                        data: returned(levels),
                    },
                    csrf: None,
                },
                Input::NoHandler,
                Input::NoHandler,
                Input::NoHandler,
                reply(),
            ],
        )
        .1
    };
    assert!(action(62).is_ok(), "action 62");
    assert_eq!(kind("action 63", action(63)), "data_depth");
}

#[test]
fn a_shared_value_that_no_template_reads_is_judged() {
    // HY-44.2, HY-44.3, HY-44.6, HY-44.12: the key `unread` is no read path of the shared data.
    let app = pages(false);
    for (label, value, expected) in [
        (
            "infinity",
            Value::Number(f64::INFINITY),
            "data_number_not_finite",
        ),
        ("nan", Value::Number(f64::NAN), "data_number_not_finite"),
        (
            "2^53",
            Value::Number(9_007_199_254_740_992.0),
            "data_number_range",
        ),
        ("depth", deep(), "data_depth"),
        (
            "native object",
            Value::object(Clock),
            "data_unsupported_type",
        ),
        (
            "native object in a list",
            Value::list(vec![Value::object(Clock)]),
            "data_unsupported_type",
        ),
    ] {
        for page in [PageKind::Html, PageKind::DocumentJson] {
            let (calls, result) = run(
                &app,
                &input(page, false),
                vec![
                    Input::Shared {
                        shared: entry("unread", value.clone()),
                    },
                    Input::NoHandler,
                    Input::NoHandler,
                    reply(),
                ],
            );
            assert_eq!(calls, [Call::Shared], "{label}");
            assert_eq!(kind(label, result), expected, "{label} {page:?}");
        }
    }
}

#[test]
fn the_data_of_a_loader_that_no_template_reads_is_judged() {
    // HY-44.3: the loader of a manifest region and the loader of the route.
    let app = pages(false);
    let native = || Input::Loaded {
        data: entry("unread", Value::object(Clock)),
    };
    let (_, result) = run(
        &app,
        &input(PageKind::Html, false),
        vec![Input::NoHandler, native(), Input::NoHandler, reply()],
    );
    assert_eq!(kind("region", result), "data_unsupported_type");
    let (_, result) = run(
        &app,
        &input(PageKind::Html, false),
        vec![
            Input::NoHandler,
            Input::NoHandler,
            Input::Loaded {
                data: entry("unread", Value::Number(f64::NEG_INFINITY)),
            },
            reply(),
        ],
    );
    assert_eq!(kind("route", result), "data_number_not_finite");
}

#[test]
fn the_data_of_an_action_that_no_template_reads_is_judged() {
    // HY-26.2, HY-58.3, HY-44.3: the data of the action is data of the page region.
    let app = pages(false);
    let (calls, result) = run(
        &app,
        &input(PageKind::Html, true),
        vec![
            Input::Action {
                outcome: ActionOutcome::Page {
                    status: 422,
                    data: entry("unread", Value::object(Clock)),
                },
                csrf: None,
            },
            Input::NoHandler,
            Input::NoHandler,
            Input::NoHandler,
            reply(),
        ],
    );
    assert_eq!(calls.first(), Some(&Call::Action));
    assert_eq!(kind("action", result), "data_unsupported_type");
}

#[test]
fn a_native_object_that_a_template_reads_is_judged() {
    // HY-44.6: the check is not the render; a native object fails also where a template would write it.
    let app = pages(false);
    let (_, result) = run(
        &app,
        &input(PageKind::Html, false),
        vec![
            Input::NoHandler,
            Input::NoHandler,
            Input::Loaded {
                data: entry("name", Value::object(Clock)),
            },
            reply(),
        ],
    );
    assert_eq!(kind("read", result), "data_unsupported_type");
}

#[test]
fn a_context_is_judged_when_its_handler_returns() {
    // HY-44.3, HY-125.9: a document that embeds no data writes no JSON text of its context.
    let app = pages(true);
    for (label, value, expected) in [
        (
            "native object",
            Value::object(Clock),
            "data_unsupported_type",
        ),
        ("nan", Value::Number(f64::NAN), "data_number_not_finite"),
    ] {
        let (calls, result) = run(
            &app,
            &input(PageKind::Html, false),
            vec![Input::Context {
                context: entry("unread", value),
            }],
        );
        assert_eq!(calls, [Call::Context], "{label}");
        assert_eq!(kind(label, result), expected, "{label}");
    }
}

#[test]
fn a_page_of_values_of_the_data_model_answers() {
    // HY-44.1: an unread value of the data model passes and is removed (HY-73.29).
    let app = pages(true);
    let mut unread = OrderedMap::new();
    unread.insert("n".to_owned(), Value::Number(9_007_199_254_740_991.0));
    let (_, result) = run(
        &app,
        &input(PageKind::DocumentJson, false),
        vec![
            Input::Context {
                context: entry("locale", Value::text("ko")),
            },
            Input::Shared {
                shared: entry("unread", Value::map(unread)),
            },
            Input::Loaded {
                data: entry("count", Value::Number(1.0)),
            },
            Input::Loaded {
                data: entry("name", Value::text("n")),
            },
            reply(),
        ],
    );
    match result {
        Ok(Answer::Json { status, text }) => {
            assert_eq!(status, 200);
            assert!(text.contains(r#""shared":{"title":"Home"}"#), "{text}");
            assert!(
                text.contains(r#""regions":{"side":{"count":1},"content":{"name":"n"}}"#),
                "{text}"
            );
        }
        other => panic!("{other:?}"),
    }
}
