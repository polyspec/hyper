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
    let member: fn(&mut Pages, &str, Given) -> Result<(), Error> = Pages::register;
    let _ = member;
}
