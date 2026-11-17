//! The function that `pages.register` takes (HYC-24.9, binding GN-6z): a generated binding gives the core a function
//! of the application in the form of the interface contract, the arguments and the environment of the call borrowed,
//! and a template value or a failure whose kind is an error of hyper.

use binding_core::Failure;
use polyspec_hyper::steps::Pages;
use polyspec_hyper::Error;
use polyspec_template::{Environment, Value};

/// The form in which a binding gives the function parameter `host_function` of the contract.
type Given = Box<dyn Fn(&[Value], &Environment) -> Result<Value, Failure<Error>> + Send + Sync>;

#[test]
fn register_takes_the_function_in_the_form_of_the_contract() {
    // HYC-24.9: the member that the contract names `pages.register` takes that form by value.
    let _: fn(&mut Pages, &str, Given) -> Result<(), Error> = Pages::register;
}

mod failures {
    //! What the template language receives from a function of the application that fails (HYC-24.9, template
    //! FUN-46): `steps::host_function` gives the engine the host function that calls a function of the contract.

    use binding_core::{Failure, Native, NativeObject, Raised};
    use polyspec_hyper::steps::{host_function, PageFunction};
    use polyspec_hyper::Error;
    use polyspec_template::{BindError, Env, ErrorCode, FunctionContext, HostError, Value};

    fn called(function: PageFunction) -> Result<Value, HostError> {
        let env = Env {
            timezone: "Z".to_owned(),
            now: 0.0,
        };
        host_function(function)(&[], &FunctionContext { env: &env })
    }

    #[test]
    fn the_value_of_the_function_is_the_value_of_the_call() {
        let result = called(Box::new(|_, _| Ok(Value::Bool(true))));
        assert!(matches!(result, Ok(Value::Bool(true))), "{result:?}");
    }

    #[test]
    fn a_failure_of_the_data_model_is_the_binding_failure_of_the_returned_value() {
        // VAL-19: the render fails with the code of the binding error.
        let result = called(Box::new(|_, _| {
            Err(Failure::Kind(Error::DataModel(BindError {
                code: ErrorCode::DataUnsupportedType,
                message: "a native object".to_owned(),
            })))
        }));
        match result {
            Err(HostError::Data(error)) => {
                assert_eq!(error.code, ErrorCode::DataUnsupportedType);
                assert_eq!(error.message, "a native object");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn another_kind_of_hyper_reaches_the_caller_of_the_render_as_that_error() {
        // FUN-46: the error of host code reaches the caller of `render` unchanged.
        let result = called(Box::new(|_, _| Err(Failure::Kind(Error::InvalidCsrfForm))));
        match result {
            Err(HostError::Callback(error)) => {
                assert_eq!(error.downcast_ref::<Error>(), Some(&Error::InvalidCsrfForm));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_error_of_rust_host_code_reaches_the_caller_of_the_render_unchanged() {
        let result = called(Box::new(|_, _| {
            Err(Failure::Callback("the lookup failed".into()))
        }));
        match result {
            Err(HostError::Callback(error)) => assert_eq!(error.to_string(), "the lookup failed"),
            other => panic!("{other:?}"),
        }
    }

    /// What a binding keeps for an exception of language code.
    #[derive(Debug)]
    struct Thrown;

    impl NativeObject for Thrown {}

    #[test]
    fn an_exception_of_language_code_reaches_the_caller_of_the_render_as_it_was_raised() {
        let raised = Raised::from_generated(Native::new(Thrown));
        let given = raised.clone();
        let result = called(Box::new(move |_, _| Err(Failure::Raised(given.clone()))));
        match result {
            Err(HostError::Raised(error)) => assert_eq!(error, raised),
            other => panic!("{other:?}"),
        }
    }
}

mod entries {
    //! The entries of `functions` that fail the open (HYC-24.5, HYC-24.7, HYC-24.8): the cases of
    //! `contracts/functions.json` that state `openFails`, and the message of a registration that the template
    //! language refuses.

    use std::collections::HashMap;
    use std::path::PathBuf;

    use binding_core::Kinds;
    use polyspec_hyper::render::{check_function_entry, Templates};
    use polyspec_hyper::Error;
    use polyspec_template::{AstProgram, EngineOptions, HostFunction, Value};
    use serde_json::Value as Json;

    fn cases() -> Json {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = root.join("../../contracts/functions.json");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) => panic!("{}: {error}", path.display()),
        };
        match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(error) => panic!("{}: {error}", path.display()),
        }
    }

    /// The function kind `suffix` of the cases: its first argument, a string, followed by "!".
    fn suffix() -> HostFunction {
        Box::new(|args, _| match args.first() {
            Some(Value::Str(text)) => Ok(Value::Str(format!("{text}!"))),
            _ => Ok(Value::Null),
        })
    }

    /// The templates of the application of a case, without a function.
    fn templates(file: &Json, case: &Json) -> Templates {
        let application = match case["application"].as_str() {
            Some(name) => &file["applications"][name],
            None => panic!("{}: no application", case["id"]),
        };
        let sources: Vec<(String, String)> = application["templates"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(name, source)| Some((name.clone(), source.as_str()?.to_owned())))
            .collect();
        assert!(!sources.is_empty(), "{}: no template", case["id"]);
        match Templates::new(&sources, HashMap::new()) {
            Ok(templates) => templates,
            Err(error) => panic!("{}: {error}", case["id"]),
        }
    }

    /// Opens the functions of a case as a host does: the core judges each entry (HYC-24.7), and the entry that is a
    /// function is registered (HYC-24.9).
    fn open(file: &Json, case: &Json) -> Result<(), Error> {
        let mut templates = templates(file, case);
        for (name, kind) in case["functions"].as_object().into_iter().flatten() {
            match kind.as_str() {
                Some("suffix") => {
                    check_function_entry(name, true)?;
                    templates.register(name, suffix())?;
                }
                Some("not_a_function") => check_function_entry(name, false)?,
                _ => panic!("{}: the function kind {kind}", case["id"]),
            }
        }
        Ok(())
    }

    #[test]
    fn the_cases_whose_open_fails_fail_with_invalid_application_and_their_message() {
        let file = cases();
        let mut ran = Vec::new();
        for case in file["cases"].as_array().into_iter().flatten() {
            if case["openFails"] != Json::Bool(true) {
                continue;
            }
            let error = match open(&file, case) {
                Err(error) => error,
                Ok(()) => panic!("{}: the open did not fail", case["id"]),
            };
            assert_eq!(error.kind(), "invalid_application", "{}", case["id"]);
            if let Some(message) = case["openError"].as_str() {
                assert_eq!(error.to_string(), message, "{}", case["id"]);
            }
            match case["id"].as_str() {
                Some(id) => ran.push(id.to_owned()),
                None => panic!("a case has no id: {case}"),
            }
        }
        assert_eq!(
            ran,
            [
                "a_built_in_name_fails_the_open",
                "a_value_that_is_not_a_function_fails_the_open",
            ]
        );
    }

    #[test]
    fn an_entry_that_is_a_function_passes() {
        assert_eq!(check_function_entry("shout", true), Ok(()));
    }

    #[test]
    fn a_registration_that_the_template_language_refuses_keeps_its_message() {
        // HYC-24.8: the message is the one of `register` of the template language for the same name.
        let refused = match AstProgram::new(EngineOptions::default()) {
            Ok(mut program) => match program.register("upper", suffix()) {
                Err(error) => error.to_string(),
                Ok(()) => panic!("the template language registered the built-in name upper"),
            },
            Err(error) => panic!("{error}"),
        };
        let mut templates = match Templates::new(&[], HashMap::new()) {
            Ok(templates) => templates,
            Err(error) => panic!("{error}"),
        };
        match templates.register("upper", suffix()) {
            Err(error) => {
                assert_eq!(error.kind(), "invalid_application");
                assert_eq!(error.to_string(), refused);
            }
            Ok(()) => panic!("the core registered the built-in name upper"),
        }
    }
}
