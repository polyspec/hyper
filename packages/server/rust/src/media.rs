//! The media type of a request (HY-116, HY-117, HY-119): the candidates of a path, their order among equal weights,
//! the 406 of a request that accepts none of them and the `Vary` of each response. The grammar and the weights of
//! `Accept` are http-negotiate's (NG-5 to NG-10); the writing of a media type is http-media-type's (MT-6).

use polyspec_http_media_type::{format, MediaType, Parameter};
use polyspec_http_negotiation::{Accept, Candidate, CandidateParameter, Matching};

use crate::representation::Entry;
use crate::Error;

/// The media type of a page (HY-15.2).
pub const PAGE: &str = "text/html";
/// The media type of the page data (HY-15.1).
pub const PAGE_DATA: &str = "application/vnd.hyper+json";

/// The types that a path serves besides the representations of its route (HY-116.14): under a chosen request the
/// data base path serves no page and the path of HY-62.22 serves only the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Served {
    pub page: bool,
    pub page_data: bool,
}

/// The selected media type of a request (HY-116.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selected {
    /// `text/html`.
    Page,
    /// `application/vnd.hyper+json`.
    PageData,
    /// The entry at `entry` of the representations of the route, with the value of each required parameter, in the
    /// order of `parameters`, that the deciding range names (HY-119.5).
    Representation { entry: usize, values: Vec<Vec<u8>> },
}

/// The outcome of the selection (HY-116.11, HY-116.13).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    /// The type of the highest weight.
    Selected(Selected),
    /// No type has a weight above 0: the request receives 406 with this body and `Vary: Accept` (HY-116.13,
    /// HY-117.3).
    NotAcceptable { body: Vec<u8> },
}

/// What a candidate stands for.
enum Member {
    Page,
    PageData,
    Entry(usize),
}

/// A candidate without parameters whose ranges match it whatever their parameters (HY-116.19, NG-8.3).
fn bare(r#type: &str, subtype: &str) -> Candidate {
    Candidate {
        r#type: r#type.to_owned(),
        subtype: subtype.to_owned(),
        parameters: Vec::new(),
        matching: Matching::Ignore,
        wildcards: true,
    }
}

/// Selects the media type of a request (HY-116.17 to HY-116.20, HY-116.11): the candidates are the page and the page
/// data that the path serves and the declared types in their order; among equal weights the first counts, and a
/// weight of 0 is not acceptable.
///
/// # Errors
/// The `invalid_accept` and `invalid_weight` of http-negotiate (HY-116.18), and `internal` when a weight names a range
/// that the field does not hold.
pub fn select(
    accept_lines: &[Vec<u8>],
    served: Served,
    entries: &[Entry],
) -> Result<Selection, Error> {
    let accept = Accept::parse(accept_lines)?;
    let mut members = Vec::new();
    let mut candidates = Vec::new();
    if served.page {
        members.push(Member::Page);
        candidates.push(bare("text", "html"));
    }
    if served.page_data {
        members.push(Member::PageData);
        candidates.push(bare("application", "vnd.hyper+json"));
    }
    for (index, entry) in entries.iter().enumerate() {
        members.push(Member::Entry(index));
        candidates.push(Candidate {
            r#type: entry.r#type.clone(),
            subtype: entry.subtype.clone(),
            parameters: entry
                .parameters
                .iter()
                .map(|(name, values)| CandidateParameter {
                    name: name.clone(),
                    values: values.clone(),
                })
                .collect(),
            matching: Matching::Exact,
            wildcards: false,
        });
    }
    let weights = accept.weigh(&candidates)?;
    let mut best: Option<(usize, u64)> = None;
    for (index, weight) in weights.iter().enumerate() {
        // HY-116.11: a later candidate wins only with a higher weight, so equal weights keep the order.
        let better = match best {
            Some((_, top)) => weight.weight > top,
            None => weight.weight > 0,
        };
        if better {
            best = Some((index, weight.weight));
        }
    }
    let Some((index, _)) = best else {
        return Ok(Selection::NotAcceptable {
            body: listing(served, entries)?,
        });
    };
    let selected = match members.get(index) {
        Some(Member::Page) => Selected::Page,
        Some(Member::PageData) => Selected::PageData,
        Some(Member::Entry(entry_index)) => {
            let entry = entries
                .get(*entry_index)
                .ok_or(Error::Internal("a candidate without its entry"))?;
            let range_index = weights
                .get(index)
                .and_then(|weight| weight.range)
                .ok_or(Error::Internal("a weight above 0 without its range"))?;
            let range = match usize::try_from(range_index) {
                Ok(range_index) => accept.ranges().get(range_index),
                Err(_) => None,
            }
            .ok_or(Error::Internal(
                "a weight names a range that the field does not hold",
            ))?;
            let mut values = Vec::with_capacity(entry.parameters.len());
            for (name, _) in &entry.parameters {
                let parameter = range
                    .parameters
                    .iter()
                    .find(|parameter| &parameter.name == name)
                    .ok_or(Error::Internal(
                        "an exact range without a required parameter",
                    ))?;
                values.push(parameter.value.clone());
            }
            Selected::Representation {
                entry: *entry_index,
                values,
            }
        }
        None => return Err(Error::Internal("a weight without its candidate")),
    };
    Ok(Selection::Selected(selected))
}

/// The `Content-Type` of a representation (HY-119.4): the type and, for each required parameter in the order of
/// `parameters`, its name and the selected value, written by `format` of http-media-type (MT-6).
///
/// # Errors
/// `internal` when the values do not match the parameters, or when a checked entry cannot be written.
pub fn content_type(entry: &Entry, values: &[Vec<u8>]) -> Result<Vec<u8>, Error> {
    if values.len() != entry.parameters.len() {
        return Err(Error::Internal(
            "a selection without a value of every parameter",
        ));
    }
    let media_type = MediaType {
        r#type: entry.r#type.clone(),
        subtype: entry.subtype.clone(),
        parameters: entry
            .parameters
            .iter()
            .zip(values)
            .map(|((name, _), value)| Parameter {
                name: name.clone(),
                value: value.clone(),
            })
            .collect(),
    };
    match format(&media_type) {
        Ok(text) => Ok(text),
        Err(_) => Err(Error::Internal("a checked entry that cannot be written")),
    }
}

/// The body of the 406 (HY-116.13): each served type on a line that ends with a line feed, the page, the page data,
/// then each declared type once for each combination of one served value of every required parameter, in the order
/// of the values of the first parameter, then of the next.
///
/// # Errors
/// `internal` when a checked entry cannot be written.
pub fn listing(served: Served, entries: &[Entry]) -> Result<Vec<u8>, Error> {
    let mut body = Vec::new();
    if served.page {
        body.extend_from_slice(PAGE.as_bytes());
        body.push(b'\n');
    }
    if served.page_data {
        body.extend_from_slice(PAGE_DATA.as_bytes());
        body.push(b'\n');
    }
    for entry in entries {
        let mut combinations: Vec<Vec<Vec<u8>>> = vec![Vec::new()];
        for (_, values) in &entry.parameters {
            combinations = combinations
                .iter()
                .flat_map(|combination| {
                    values.iter().map(move |value| {
                        let mut next = combination.clone();
                        next.push(value.clone());
                        next
                    })
                })
                .collect();
        }
        for combination in combinations {
            body.extend(content_type(entry, &combination)?);
            body.push(b'\n');
        }
    }
    Ok(body)
}

/// The `Vary` of a page or page data response and of the shell (HY-117.1).
#[must_use]
pub fn page_vary(has_context: bool) -> &'static str {
    if has_context {
        "Accept, HX-Request, HX-Current-URL, Hyper-Context"
    } else {
        "Accept, HX-Request, HX-Current-URL"
    }
}

/// The `Vary` of every response of a representation request after the selection (HY-117.2): `Accept`, then the
/// `vary` names of its entry.
#[must_use]
pub fn representation_vary(entry: &Entry) -> String {
    let mut vary = String::from("Accept");
    for name in &entry.vary {
        vary.push_str(", ");
        vary.push_str(name);
    }
    vary
}

/// The `Vary` of the 400 and the 406 of the selection (HY-117.3).
pub const SELECTION_VARY: &str = "Accept";
