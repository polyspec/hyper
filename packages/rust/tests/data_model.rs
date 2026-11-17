//! The data model check of a page (HY-44.3, HY-44.6, HY-44.9): the steps of a page judge every value that the context
//! handler, the shared handler and the loaders return before the read paths remove the values that no template reads
//! (HY-73.29), so a value outside the data model fails the page also when no template reads it, with the kind of the
//! template data model.

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
        stored: Map::new(),
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

const REPLY: Input = Input::Reply {
    embeds: false,
    status: None,
};

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

#[test]
fn a_shared_value_that_no_template_reads_is_judged() {
    // HY-44.2, HY-44.3, HY-44.6, HY-44.9: the key `unread` is no read path of the shared data.
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
                    REPLY,
                ],
            );
            assert_eq!(calls.last(), Some(&Call::Reply), "{label}");
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
        vec![Input::NoHandler, native(), Input::NoHandler, REPLY],
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
            REPLY,
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
            },
            Input::NoHandler,
            Input::NoHandler,
            Input::NoHandler,
            REPLY,
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
            REPLY,
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
            REPLY,
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
