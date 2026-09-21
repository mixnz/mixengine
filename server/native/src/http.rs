//! The one shape every failure takes (D4a).

use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

/// A failure, in the one shape. `code` is a stable identifier a client switches on; `message` is
/// for a log and is **never shown to a person** — MixLab's strings live in `src/i18n/` and are
/// chosen by `code`.
pub struct Failure {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub members: Map<String, Value>,
    pub headers: Vec<(HeaderName, HeaderValue)>,
}

impl Failure {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            members: Map::new(),
            headers: Vec::new(),
        }
    }

    pub fn with(mut self, member: &str, value: Value) -> Self {
        self.members.insert(member.to_owned(), value);
        self
    }

    pub fn header(mut self, name: HeaderName, value: HeaderValue) -> Self {
        self.headers.push((name, value));
        self
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let mut error = Map::new();
        error.insert("code".to_owned(), json!(self.code));
        error.insert("message".to_owned(), json!(self.message));
        error.extend(self.members);

        let mut headers = HeaderMap::new();
        for (name, value) in self.headers {
            headers.insert(name, value);
        }

        (
            self.status,
            headers,
            axum::Json(json!({ "error": Value::Object(error) })),
        )
            .into_response()
    }
}

pub fn invalid_request(message: impl Into<String>) -> Failure {
    Failure::new(StatusCode::BAD_REQUEST, "invalid-request", message)
}

/// The address is a thing a person typed, so it gets a code of its own: an application showing
/// *"something in what you sent is wrong"* for a mistyped address is showing the wrong sentence.
pub fn invalid_email() -> Failure {
    Failure::new(
        StatusCode::BAD_REQUEST,
        "invalid-email",
        "That is not a valid email address.",
    )
}

/// A code from a letter, which is **not** a session token: one means *that code is wrong* and the
/// other means *you have been signed out*. An application switching on the code alone would have
/// rendered the wrong one of those.
pub fn invalid_code() -> Failure {
    Failure::new(
        StatusCode::BAD_REQUEST,
        "invalid-code",
        "That code is invalid or has expired.",
    )
}

pub fn invalid_token() -> Failure {
    Failure::new(
        StatusCode::UNAUTHORIZED,
        "invalid-token",
        "That token is invalid or has expired.",
    )
}

pub fn not_found() -> Failure {
    Failure::new(StatusCode::NOT_FOUND, "not-found", "No such route.")
}
