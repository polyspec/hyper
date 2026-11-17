//! The body of a request as http-form reads it (H35.11): the bytes of a body under its four limits and in their order
//! (F-9, F-24, F-25), the form values and the files of a body (F-21, F-22), and the read and the move of a file (F-11).
//! The three servers read every request body through these types and hold no parser and no limit check of their own.
//! Each failure of http-form is the error `Error::Form` of hyper, with the kind, the status and the category of
//! http-form (HY-132.3).

use std::path::{Path, PathBuf};

use binding_core::Io;

use crate::Error;

/// The four limits of a body (F-25, HY-59.15, HY-131.7 to HY-131.12): the body limit, the value limit of a body that
/// is one value and of the text values of a body read in chunks, the part limit and the file limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BodyLimits {
    /// The body limit in bytes (F-25.1, HY-59.15).
    pub limit: u64,
    /// The value limit in bytes (F-25.2, HY-131.7).
    pub value_limit: u64,
    /// The part limit of a body read in chunks (F-25.3, HY-131.10).
    pub part_limit: u64,
    /// The file limit in bytes of each file of a body read in chunks (F-25.4, HY-114).
    pub file_limit: u64,
}

impl From<&BodyLimits> for polyspec_http_form::BodyLimits {
    fn from(limits: &BodyLimits) -> Self {
        polyspec_http_form::BodyLimits {
            limit: limits.limit,
            value_limit: limits.value_limit,
            part_limit: limits.part_limit,
            file_limit: limits.file_limit,
        }
    }
}

/// The text fields and the files of a body (F-21, F-22), each name in the order of its first occurrence with its
/// values in request order.
#[derive(Debug, Clone, Default)]
pub struct Form {
    /// The text fields (F-21).
    pub fields: Vec<(String, Vec<String>)>,
    /// The files (F-22).
    pub files: Vec<(String, Vec<UploadedFile>)>,
}

impl From<polyspec_http_form::Form> for Form {
    fn from(form: polyspec_http_form::Form) -> Self {
        Form {
            fields: form.fields,
            files: form
                .files
                .into_iter()
                .map(|(name, files)| (name, files.into_iter().map(UploadedFile).collect()))
                .collect(),
        }
    }
}

/// A file of a body (F-22, F-11): its name, its filename, its content type and its bytes, held as a value or stored in
/// the directory of its request.
#[derive(Debug, Clone)]
pub struct UploadedFile(polyspec_http_form::UploadedFile);

impl UploadedFile {
    /// A file that holds its bytes as a value, such as one that a test gives.
    ///
    /// # Errors
    ///
    /// `internal` when an invariant of http-form does not hold.
    pub fn new(name: &str, filename: &str, content_type: &str, content: &[u8]) -> Result<Self, Error> {
        Ok(UploadedFile(polyspec_http_form::UploadedFile::from_value(name, filename, content_type, content)?))
    }

    /// The name of the field of the file.
    #[must_use]
    pub fn name(&self) -> String {
        self.0.name()
    }

    /// The filename of the part, as the request gives it.
    #[must_use]
    pub fn filename(&self) -> String {
        self.0.filename()
    }

    /// The content type of the part, or the empty text for a part without one.
    #[must_use]
    pub fn content_type(&self) -> String {
        self.0.content_type()
    }

    /// The number of bytes of the file.
    #[must_use]
    pub fn size(&self) -> u64 {
        self.0.size()
    }

    /// The bytes of the file (F-11).
    ///
    /// # Errors
    ///
    /// `moved` after a move, `removed` after the removal of its directory, and a failure of the file system.
    pub fn content(&self, io: Io) -> Result<Vec<u8>, Error> {
        Ok(self.0.content(io)?)
    }

    /// Moves the file to `path` (F-11).
    ///
    /// # Errors
    ///
    /// `exists`, `moved`, `removed`, `source_left`, `partial_target` and a failure of the file system.
    pub fn move_to(&self, io: Io, path: &Path) -> Result<(), Error> {
        Ok(self.0.move_to(io, path)?)
    }
}

/// The body of a request, read in chunks under its limits (F-9, F-24, F-25, HY-59.15, HY-131.32): the bytes of a body
/// that is one value, or the parts of a `multipart/form-data` body whose files are stored in a directory of the
/// request.
pub struct RequestBody(polyspec_http_form::RequestBody);

impl RequestBody {
    /// Starts the body of the content type `content_type` with its limits. `content_length` is the value of the
    /// `Content-Length` field as the host received it, or none without one: a value that is no number fails with
    /// `invalid_content_length` and a number above the body limit with `body_limit`, before any byte is read (HY-131.29,
    /// F-9, F-25.1). `stream` tells whether a multipart body is
    /// read in chunks, which it is when `multipart/form-data` is a form type of the application (HY-131.1). The reader
    /// in chunks starts only for a `multipart/form-data` type with a boundary: any other content type, one that is no
    /// media type and a multipart type without a boundary or with an empty one included, is held as one value and
    /// fails no reading, because its `Content-Type` is judged after the route (HY-57.15, HY-59.12, HY-113.24).
    ///
    /// # Errors
    ///
    /// `invalid_content_length`, `body_limit`, a failure of the file system while the directory of the files is
    /// created, and `internal`.
    pub fn start(
        io: Io,
        content_type: Option<&[u8]>,
        content_length: Option<&[u8]>,
        stream: bool,
        limits: &BodyLimits,
    ) -> Result<Self, Error> {
        let stream = stream && matches!(polyspec_http_form::multipart_boundary(content_type), Ok(Some(_)));
        Ok(RequestBody(polyspec_http_form::RequestBody::start(io, content_type, content_length, stream, &limits.into())?))
    }

    /// Reads the next chunk. The first failure of the body is its error and the error of every later call, and the
    /// body then holds no bytes and no open file (F-25, HY-131.32): the body limit at the byte after it, the value
    /// limit, the part limit and the file limit, in the order of the byte that passes each (F-8).
    ///
    /// # Errors
    ///
    /// `invalid`, `header_limit`, `body_limit`, `value_limit`, `part_limit`, `file_limit`, `finished`, `removed`, a
    /// failure of the file system and `internal`.
    pub fn feed(&mut self, io: Io, chunk: &[u8]) -> Result<(), Error> {
        Ok(self.0.feed(io, chunk)?)
    }

    /// Ends the body.
    ///
    /// # Errors
    ///
    /// The failure of the body, as [`RequestBody::feed`] gives it, and `removed`.
    pub fn finish(&mut self, io: Io) -> Result<(), Error> {
        Ok(self.0.finish(io)?)
    }

    /// The text fields and the files of a body read in chunks (HY-131.5).
    ///
    /// # Errors
    ///
    /// `not_streamed` for a body held as one value, `not_finished` before its end, and the failure of the body.
    pub fn parts(&self) -> Result<Form, Error> {
        Ok(self.0.parts()?.into())
    }

    /// The body as one value: no bytes for a body read in chunks and for a body that failed.
    #[must_use]
    pub fn held(&self) -> Vec<u8> {
        self.0.held()
    }

    /// The number of bytes that were read.
    #[must_use]
    pub fn size(&self) -> u64 {
        self.0.size()
    }

    /// Whether the body is read in chunks.
    #[must_use]
    pub fn streamed(&self) -> bool {
        self.0.streamed()
    }

    /// The directory of the files of the body, or none for a body that is one value.
    #[must_use]
    pub fn directory(&self) -> Option<PathBuf> {
        self.0.directory()
    }

    /// Removes the directory of the files with the files that were not moved (HY-131.14).
    ///
    /// # Errors
    ///
    /// A failure of the file system and `internal`.
    pub fn remove(&mut self, io: Io) -> Result<(), Error> {
        Ok(self.0.remove(io)?)
    }
}

/// The text fields and the files of a body held as one value, under the value limit (F-21, F-22, F-25.2): an
/// `application/x-www-form-urlencoded` body or a `multipart/form-data` body that is not read in chunks.
///
/// # Errors
///
/// `invalid`, `header_limit`, `no_boundary`, `malformed_content_type`, `value_limit` and `internal`.
pub fn read_held_body(content_type: Option<&[u8]>, body: &[u8], limits: &BodyLimits) -> Result<Form, Error> {
    Ok(polyspec_http_form::read_held_body(content_type, body, &limits.into())?.into())
}

/// The form values of an `application/x-www-form-urlencoded` text (F-20, F-21).
///
/// # Errors
///
/// `invalid` for a name or a value that is not UTF-8.
pub fn parse_urlencoded(text: &[u8]) -> Result<Vec<(String, Vec<String>)>, Error> {
    Ok(polyspec_http_form::parse_urlencoded(text)?)
}
