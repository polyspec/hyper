//! The shape of the interface contract that every binding target can hold: a case of a variant has no field
//! with the name of the tag of the variant, because the tag and the field would be one key of the value of a case
//! (binding GN-6v); and no required field of a record follows a field with a default, because a member that takes
//! the record takes its fields as parameters in their order, and a parameter that the caller may leave out is
//! followed by such parameters only (binding U-2).

use std::path::PathBuf;

fn contract() -> Result<serde_json::Value, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("interface.json");
    let text =
        std::fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
}

/// The units of the contract of the kind `kind`.
fn units<'a>(contract: &'a serde_json::Value, kind: &str) -> Vec<&'a serde_json::Value> {
    contract["units"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|unit| unit["kind"].as_str() == Some(kind))
        .collect()
}

/// The words of a name as one name.
fn joined(name: &serde_json::Value) -> String {
    name.as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .collect::<Vec<_>>()
        .join("_")
}

/// The text of an item of the contract; an item that is no text fails the test.
fn text(value: &serde_json::Value) -> Result<&str, String> {
    value.as_str().ok_or_else(|| format!("{value}: not a text"))
}

fn fields(holder: &serde_json::Value) -> impl Iterator<Item = &serde_json::Value> {
    holder["fields"].as_array().into_iter().flatten()
}

#[test]
fn no_field_of_a_case_has_the_name_of_the_tag() -> Result<(), String> {
    let contract = contract()?;
    let variants = units(&contract, "variant");
    assert!(!variants.is_empty(), "the contract has no variant");
    let mut found = Vec::new();
    for unit in variants {
        let tag = joined(&unit["tag"]);
        assert!(!tag.is_empty(), "{}: no tag", unit["id"]);
        for case in unit["cases"].as_array().into_iter().flatten() {
            for field in fields(case) {
                if joined(&field["name"]) == tag {
                    found.push(format!(
                        "{}.{}.{tag}",
                        text(&unit["id"])?,
                        text(&case["value"])?
                    ));
                }
            }
        }
    }
    assert_eq!(found, Vec::<String>::new());
    Ok(())
}

#[test]
fn no_required_field_of_a_record_follows_a_field_with_a_default() -> Result<(), String> {
    let contract = contract()?;
    let records = units(&contract, "record");
    assert!(!records.is_empty(), "the contract has no record");
    let mut found = Vec::new();
    for unit in records {
        let mut defaulted = false;
        for field in fields(unit) {
            if field.get("default").is_some() {
                defaulted = true;
            } else if defaulted {
                found.push(format!("{}.{}", text(&unit["id"])?, joined(&field["name"])));
            }
        }
    }
    assert_eq!(found, Vec::<String>::new());
    Ok(())
}
