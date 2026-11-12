//! The page of a request as steps (HY-26, HY-58.3, HY-124.2 to HY-124.4, HY-18, HY-75, HY-92): the core asks and the
//! host calls. The handlers of an application (its action, its context handler, its shared handler and its loaders)
//! are code of the application, which may await (HY-124.10, HY-62.10) and may throw. The core therefore does not call
//! them: `PageRequest` is a state machine without I/O that `next` moves on, and each step either asks the host to call
//! one handler and to give its result to the next `next`, or gives the answer. The host branches on the kind of the
//! step alone. So the core holds no object of the language, a Node handler is awaited on the event loop of Node, and
//! the exception of a handler does not pass through a frame of Rust; the host keeps it and answers it with HY-43. A
//! function of a template is the one handler that the core calls while it renders (`render`), because a render is one
//! call that the engine does not suspend.

use std::sync::Arc;

use bindgen_core::Failure;
use polyspec_template::{Env, OrderedMap, Value};

use crate::context::{member, with_context};
use crate::keep::cookie_values;
use crate::manifest::{Manifest, Route};
use crate::page::{json_value, kept_values, regions, shared_data, Response};
use crate::reads::{keep, Read};
use crate::render::{Document, Templates};
use crate::Error;

/// The read paths of a route (HY-73.23): of its shared data and of each region of its documents.
pub struct RouteReads {
    /// The read paths of the shared data.
    pub shared: Read,
    /// The read paths of each region, by name.
    pub regions: Vec<(String, Read)>,
}

/// What an application holds for its pages, which it reads when it opens.
pub struct Application {
    /// The manifest (HY-1, HY-2).
    pub manifest: Manifest,
    /// The templates and the functions of the application (HY-12, HYC-24).
    pub templates: Templates,
    /// The read paths of every route, by the name of the route (HY-73).
    pub reads: Vec<(String, RouteReads)>,
    /// The build id (HY-125).
    pub build: String,
    /// The time zone of the server (HY-14.2).
    pub timezone: String,
    /// Whether the application declares a context handler (HY-124.1).
    pub context: bool,
}

/// The kind of a request that receives a page (HY-15).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageKind {
    /// A request that selects `text/html`: a document.
    Html,
    /// A request that selects `application/vnd.hyper+json` without `HX-Request`: JSON with every region.
    DocumentJson,
    /// A request that selects `application/vnd.hyper+json` with `HX-Request: true`: JSON with the changed regions.
    RegionJson,
}

/// What the page of a request needs that the host read before the first step.
pub struct PageInput {
    /// The route and its parameters.
    pub route: String,
    pub params: Vec<(String, String)>,
    /// The kind of the request (HY-15).
    pub kind: PageKind,
    /// Whether the request is a `POST`, which runs the action of its route (HY-26).
    pub action: bool,
    /// The masked session token of this response (HY-10.2, HY-24).
    pub csrf: String,
    /// The changed topics of the request (HY-19).
    pub changed: Vec<String>,
    /// The kept server values of the session, by region (HY-40).
    pub stored: Vec<(String, OrderedMap)>,
    /// The value of the cookie `hy-keep` of the request (HY-38.10), or `None`.
    pub keep_cookie: Option<String>,
    /// The value of `Hyper-Context`, which HY-127.2 checked, or `None`.
    pub held_hash: Option<String>,
    /// The current time of the render, in seconds since the Unix epoch, which the host reads.
    pub now: f64,
}

/// The handler that a step asks the host to call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Call {
    /// The action of the route (HY-26); its outcome is `Input::Action`.
    Action,
    /// The context handler with the selection value of the request (HY-124.2); its result is `Input::Context`.
    Context,
    /// The shared handler (HY-10.2); its result is `Input::Shared` or `Input::NoHandler`.
    Shared,
    /// The loader of the route (HY-18.3); its result is `Input::Loaded` or `Input::NoHandler`.
    RouteLoader,
    /// The loader of a route region (HY-75); its result is `Input::Loaded`, `Input::Absent` or `Input::NoHandler`.
    RouteRegionLoader(String),
    /// The loader of a manifest region; its result is `Input::Loaded` or `Input::NoHandler`.
    RegionLoader(String),
    /// The reply of the request after its handlers: whether it embeds the data and the status that it states; its
    /// result is `Input::Reply`.
    Reply,
}

/// The outcome of the action of a request, as the host found it.
#[derive(Debug, Clone, PartialEq)]
pub enum ActionOutcome {
    /// The action returned the route page with a status of 200, 409 or 422 and data (HY-26, HY-58.3).
    Page { status: u16, data: OrderedMap },
    /// The action let `REVISION_CHANGED` escape, which the server answers as the page with status 409 (HY-107).
    RevisionChanged,
    /// The action redirected, stopped or failed; the host answers it without a page (HY-124.4).
    NoPage,
}

/// The result of a call that the host gives to the next `next`.
#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    /// The first `next` of a request.
    Start,
    /// The outcome of the action.
    Action(ActionOutcome),
    /// The context map, which the binding converted to the data model (HY-125.9).
    Context(OrderedMap),
    /// The map of the shared handler.
    Shared(OrderedMap),
    /// The map that a loader returned.
    Loaded(OrderedMap),
    /// A route region loader returned null: the region is absent (HY-75.1).
    Absent,
    /// The application declares no such handler.
    NoHandler,
    /// The reply: whether it embeds the data (HY-92) and the status that it states for a page with status 200 (HY-69).
    Reply { embeds: bool, status: Option<u16> },
}

/// The answer of a page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// A document with its status (HY-12).
    Document { status: u16, html: String },
    /// A JSON response with its status (HY-17): the JSON text of HY-54.
    Json { status: u16, text: String },
    /// No page: the action redirected, stopped or failed, and the host answers it (HY-124.4).
    NoPage,
}

/// A step of the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Call a handler and give its result to the next `next`.
    Call(Call),
    /// The answer; the request is done.
    Answer(Answer),
}

/// The place of the page in its steps.
enum State {
    Start,
    Action,
    Context,
    Shared,
    /// The region at this position of `selected` waits for its loader; the page region also waits for the loaders of
    /// its route regions, by position.
    Loaders {
        region: usize,
        route_region: Option<usize>,
    },
    Reply,
    Done,
}

/// The page of one request, which `next` moves on.
pub struct PageRequest<'a> {
    app: &'a Application,
    route: &'a Route,
    input: PageInput,
    state: State,
    status: u16,
    invalid: OrderedMap,
    context: Option<OrderedMap>,
    shared: Option<OrderedMap>,
    selected: Vec<String>,
    data: Vec<(String, Value)>,
}

fn internal(reason: &'static str) -> Failure<Error> {
    Failure::Kind(Error::Internal(reason))
}

fn unexpected() -> Failure<Error> {
    internal("the host gave a page a result of another call")
}

impl<'a> PageRequest<'a> {
    /// The page of a request of a route of the application.
    ///
    /// # Errors
    /// `internal` for a route that the manifest does not hold, and for a manifest without its page region.
    pub fn new(app: &'a Application, input: PageInput) -> Result<PageRequest<'a>, Error> {
        let Some(route) = app
            .manifest
            .routes
            .iter()
            .find(|route| route.name == input.route)
        else {
            return Err(Error::Internal(
                "the page of a route that the manifest does not hold",
            ));
        };
        let selected = regions(
            &app.manifest,
            input.kind != PageKind::RegionJson,
            &input.changed,
        )?
        .iter()
        .map(|region| region.name.clone())
        .collect();
        Ok(PageRequest {
            app,
            route,
            input,
            state: State::Start,
            status: 200,
            invalid: OrderedMap::new(),
            context: None,
            shared: None,
            selected,
            data: Vec::new(),
        })
    }

    /// Moves the page on with the result of the call of the last step.
    ///
    /// # Errors
    /// The failure of a value of the data model, of a check of hyper (`shared_holds_context`, HY-124.8) or of a render
    /// with its kind, the exception of a function of a template unchanged, and `internal` for a result of another
    /// call than the last step asked for.
    pub fn next(&mut self, input: Input) -> Result<Step, Failure<Error>> {
        let state = std::mem::replace(&mut self.state, State::Done);
        match (state, input) {
            (State::Start, Input::Start) => {
                if self.input.action {
                    self.state = State::Action;
                    Ok(Step::Call(Call::Action))
                } else {
                    Ok(self.after_action())
                }
            }
            (State::Action, Input::Action(outcome)) => match outcome {
                ActionOutcome::Page { status, data } => {
                    self.status = status;
                    self.invalid = data;
                    Ok(self.after_action())
                }
                ActionOutcome::RevisionChanged => {
                    self.status = 409;
                    Ok(self.after_action())
                }
                ActionOutcome::NoPage => Ok(Step::Answer(Answer::NoPage)),
            },
            (State::Context, Input::Context(context)) => {
                self.context = Some(context);
                self.state = State::Shared;
                Ok(Step::Call(Call::Shared))
            }
            (State::Shared, Input::Shared(returned)) => {
                self.shared = Some(
                    shared_data(&self.route.title, &self.input.csrf, Some(&returned))
                        .map_err(Failure::Kind)?,
                );
                self.first_loader()
            }
            (State::Shared, Input::NoHandler) => {
                self.shared = Some(
                    shared_data(&self.route.title, &self.input.csrf, None)
                        .map_err(Failure::Kind)?,
                );
                self.first_loader()
            }
            (
                State::Loaders {
                    region,
                    route_region,
                },
                input,
            ) => self.loaded(region, route_region, input),
            (State::Reply, Input::Reply { embeds, status }) => self.answer(embeds, status),
            (_, _) => Err(unexpected()),
        }
    }

    /// After the action: the context handler for an application that declares one (HY-124.2), then the shared
    /// handler.
    fn after_action(&mut self) -> Step {
        if self.app.context {
            self.state = State::Context;
            Step::Call(Call::Context)
        } else {
            self.state = State::Shared;
            Step::Call(Call::Shared)
        }
    }

    fn is_page(&self, region: usize) -> Result<bool, Failure<Error>> {
        let page = self.app.manifest.page().map_err(Failure::Kind)?;
        Ok(self.selected.get(region).map(String::as_str) == Some(page))
    }

    /// The call of the loader of the region at a position of `selected`.
    fn call_for(&mut self, region: usize) -> Result<Step, Failure<Error>> {
        let Some(name) = self.selected.get(region).cloned() else {
            self.state = State::Reply;
            return Ok(Step::Call(Call::Reply));
        };
        self.state = State::Loaders {
            region,
            route_region: None,
        };
        if self.is_page(region)? {
            Ok(Step::Call(Call::RouteLoader))
        } else {
            Ok(Step::Call(Call::RegionLoader(name)))
        }
    }

    fn first_loader(&mut self) -> Result<Step, Failure<Error>> {
        self.call_for(0)
    }

    /// The data of a loader: its map, or the empty map without a loader (HY-18.3, HY-75.7).
    fn loaded_map(input: Input) -> Result<Option<OrderedMap>, Failure<Error>> {
        match input {
            Input::Loaded(map) => Ok(Some(map)),
            Input::NoHandler => Ok(Some(OrderedMap::new())),
            Input::Absent => Ok(None),
            Input::Start
            | Input::Action(_)
            | Input::Context(_)
            | Input::Shared(_)
            | Input::Reply { .. } => Err(unexpected()),
        }
    }

    fn loaded(
        &mut self,
        region: usize,
        route_region: Option<usize>,
        input: Input,
    ) -> Result<Step, Failure<Error>> {
        let Some(name) = self.selected.get(region).cloned() else {
            return Err(internal("a loader of a region that the page does not hold"));
        };
        let map = PageRequest::loaded_map(input)?;
        match route_region {
            None => {
                let Some(mut map) = map else {
                    // Only a route region is absent (HY-75.1).
                    return Err(unexpected());
                };
                if self.is_page(region)? {
                    // HY-26.2, HY-58.3: the route data merged with the data of the action.
                    for (key, value) in self.invalid.iter() {
                        map.insert(key.clone(), value.clone());
                    }
                    self.data.push((name, Value::Map(Arc::new(map))));
                    return self.next_route_region(region, 0);
                }
                self.data.push((name, Value::Map(Arc::new(map))));
                self.call_for(region + 1)
            }
            Some(position) => {
                if let (Some(map), Some(route_region)) = (map, self.route.regions.get(position)) {
                    self.data
                        .push((route_region.name.clone(), Value::Map(Arc::new(map))));
                }
                self.next_route_region(region, position + 1)
            }
        }
    }

    /// The call of the loader of the route region at a position, after the page region, or the next region.
    fn next_route_region(
        &mut self,
        region: usize,
        position: usize,
    ) -> Result<Step, Failure<Error>> {
        match self.route.regions.get(position) {
            Some(route_region) => {
                self.state = State::Loaders {
                    region,
                    route_region: Some(position),
                };
                Ok(Step::Call(Call::RouteRegionLoader(
                    route_region.name.clone(),
                )))
            }
            None => self.call_for(region + 1),
        }
    }

    /// The answer after the handlers (HY-17, HY-31, HY-38, HY-73, HY-128, HY-69).
    fn answer(&mut self, embeds: bool, reply_status: Option<u16>) -> Result<Step, Failure<Error>> {
        let Some(route_reads) = self
            .app
            .reads
            .iter()
            .find(|(route, _)| *route == self.route.name)
            .map(|(_, reads)| reads)
        else {
            return Err(internal("a route without its read paths (HY-73)"));
        };
        let Some(shared) = self.shared.take() else {
            return Err(internal("a page without its shared data"));
        };
        // HY-73.29: the page keeps only the paths that the templates of the route read.
        let shared = match keep(&Value::Map(Arc::new(shared)), &route_reads.shared) {
            Value::Map(map) => (*map).clone(),
            Value::Null
            | Value::Bool(_)
            | Value::Number(_)
            | Value::Str(_)
            | Value::Safe(_)
            | Value::List(_)
            | Value::Object(_) => return Err(internal("the shared data is not a map")),
        };
        let mut data = Vec::with_capacity(self.data.len());
        for (name, value) in std::mem::take(&mut self.data) {
            let Some((_, read)) = route_reads
                .regions
                .iter()
                .find(|(region, _)| *region == name)
            else {
                return Err(internal("a region without its read paths (HY-73)"));
            };
            data.push((name, keep(&value, read)));
        }
        let cookie = match &self.input.keep_cookie {
            Some(text) => cookie_values(text),
            None => Vec::new(),
        };
        let kept = kept_values(&self.app.manifest, &data, &self.input.stored, &cookie);
        // HY-69: the reply gives a page with status 200 its status.
        let status = match (self.status, reply_status) {
            (200, Some(status)) => status,
            (status, _) => status,
        };
        let json = self.input.kind != PageKind::Html;
        let route_regions: Vec<String> = self
            .route
            .regions
            .iter()
            .map(|region| region.name.clone())
            .collect();
        // HY-31.3, HY-92: a document embeds its data when its reply asks for it and a route region is present.
        let embeds = !json && crate::page::embeds(embeds, &route_regions, &data);
        let context = match (&self.context, json || embeds) {
            (Some(context), true) => Some(
                member(
                    &self.app.build,
                    context,
                    if json {
                        self.input.held_hash.as_deref()
                    } else {
                        None
                    },
                )
                .map_err(Failure::Kind)?,
            ),
            (Some(_) | None, _) => None,
        };
        let value = json_value(Response {
            timezone: &self.app.timezone,
            route: &self.route.name,
            params: &self.input.params,
            build: &self.app.build,
            context,
            shared: shared.clone(),
            regions: data.clone(),
            kept: kept.clone(),
        });
        if json {
            let text = crate::json::write(&Value::Map(Arc::new(value)))
                .map_err(|error| Failure::Kind(Error::DataModel(error)))?;
            return Ok(Step::Answer(Answer::Json { status, text }));
        }
        // HY-124.7, HY-128.4: a document renders with the context in the shared data.
        let shared = match &self.context {
            Some(context) => with_context(&shared, &Value::Map(Arc::new(context.clone())))
                .map_err(Failure::Kind)?,
            None => shared,
        };
        let html = self.app.templates.render_document(&Document {
            manifest: &self.app.manifest,
            route: self.route,
            shared: &shared,
            regions: &data,
            kept: &kept,
            env: Env {
                timezone: self.app.timezone.clone(),
                now: self.input.now,
            },
            build: &self.app.build,
            embed: if embeds { Some(&value) } else { None },
        })?;
        Ok(Step::Answer(Answer::Document { status, html }))
    }
}
