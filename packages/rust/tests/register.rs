//! The function that `pages.register` takes (HYC-24.2, binding GN-6z): a generated binding gives the core a function
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
    // HYC-24.2: the member that the contract names `pages.register` takes that form by value.
    let _: fn(&mut Pages, &str, Given) -> Result<(), Error> = Pages::register;
}

mod failures {
    //! What the template language receives from a function of the application that fails (HYC-24.2, template
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
