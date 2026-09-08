//! What crosses the boundary for a REST request. Mirrored by hand in
//! `src/modules/rest/types.ts` — nothing checks that the two agree.

use crate::secrets::Redacted;
use serde::{Deserialize, Serialize};

/// A request with every decision already made: the URL is final, the headers are final, the body
/// is already encoded. Rust chooses nothing here.
#[derive(Deserialize)]
pub struct WireRequest {
    /// What `rest_cancel` names. Minted per send, not per request.
    pub request_id: String,
    pub method: String,
    pub url: String,
    /// A list, not a map: a header may legitimately appear twice.
    pub headers: Vec<(String, String)>,
    pub body: WireBody,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub accept_invalid_certs: bool,
}

/// Redacted by hand, for the same reason `ConnectionConfig`'s is — this one is where an
/// `Authorization` header and a `Cookie` live, and where a login form's body passes through.
///
/// Header *names* stay: they are the useful half when a request is not going through, and none of
/// them is a secret. The URL stays whole for the same reason, and that is a deliberate line rather
/// than an oversight — a key in a query string would survive this. Cutting the query would take
/// the path with it in the cases where the path is all anybody wanted to see, and a request whose
/// URL cannot be printed is a request that cannot be debugged at all.
impl std::fmt::Debug for WireRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WireRequest")
            .field("request_id", &self.request_id)
            .field("method", &self.method)
            .field("url", &self.url)
            .field("headers", &HeaderNames(&self.headers))
            .field("body", &self.body)
            .field("timeout_ms", &self.timeout_ms)
            .field("follow_redirects", &self.follow_redirects)
            .field("accept_invalid_certs", &self.accept_invalid_certs)
            .finish()
    }
}

/// The header list as `{name: "***"}` — which of them were sent, and none of what was in them.
struct HeaderNames<'a>(&'a [(String, String)]);

impl std::fmt::Debug for HeaderNames<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map()
            .entries(self.0.iter().map(|(name, _)| (name, Redacted)))
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireBody {
    None,
    /// Raw and form-urlencoded alike: the frontend encoded it and declared its type.
    Text { text: String },
    /// A file streamed from disk.
    File { path: String },
    /// The one body Rust assembles, because the boundary and the file streaming are reqwest's.
    Multipart { parts: Vec<WirePart> },
}

/// A body says what kind it is and how big it is, never what is in it: a form-urlencoded body is
/// exactly where a password ends up.
impl std::fmt::Debug for WireBody {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => f.write_str("None"),
            Self::Text { text } => f.debug_struct("Text").field("bytes", &text.len()).finish(),
            // A path is not a secret, and which file failed to open is the whole question.
            Self::File { path } => f.debug_struct("File").field("path", path).finish(),
            Self::Multipart { parts } => f.debug_struct("Multipart").field("parts", parts).finish(),
        }
    }
}

#[derive(Deserialize)]
pub struct WirePart {
    pub name: String,
    /// The field's text, for a plain part.
    pub value: Option<String>,
    /// A file to send instead.
    pub path: Option<String>,
}

/// The field's name and which of the two it is. A multipart form is a form, so `value` is
/// redacted like any other body.
impl std::fmt::Debug for WirePart {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WirePart")
            .field("name", &self.name)
            .field("value", &self.value.as_ref().map(|_| Redacted))
            .field("path", &self.path)
            .finish()
    }
}

/// One response, whole. A `500` is a successful send and comes back through here like any other.
#[derive(Debug, Serialize)]
pub struct RestResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    /// Base64 even for text: a response may be an image, a PDF or a gzip, and nothing here can
    /// assume UTF-8. The 33% the encoding adds is the price of not guessing.
    pub body_base64: String,
    /// The real length, including anything cut for being over the cap.
    pub body_size: u64,
    pub truncated: bool,
    /// Where the request ended up, which is how the frontend knows it was redirected.
    pub final_url: String,
    pub total_ms: u64,
    /// Time to the last header, i.e. when the response began rather than when it finished.
    pub ttfb_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::{WireBody, WirePart, WireRequest};

    /// A request prints what it was, not what it carried.
    #[test]
    fn a_request_never_prints_its_credentials() {
        let request = WireRequest {
            request_id: "r1".to_string(),
            method: "POST".to_string(),
            url: "https://api.example/v1/login".to_string(),
            headers: vec![
                ("Authorization".to_string(), "Bearer sk-live-9f3".to_string()),
                ("Cookie".to_string(), "session=abc123".to_string()),
            ],
            body: WireBody::Text { text: "user=me&password=hunter2".to_string() },
            timeout_ms: 30_000,
            follow_redirects: true,
            accept_invalid_certs: false,
        };

        let printed = format!("{request:?}");
        for secret in ["sk-live-9f3", "session=abc123", "hunter2"] {
            assert!(!printed.contains(secret), "{secret} leaked: {printed}");
        }
        // What is left is what a failing request is actually debugged from.
        assert!(printed.contains("Authorization"), "{printed}");
        assert!(printed.contains("POST"), "{printed}");
        assert!(printed.contains("/v1/login"), "{printed}");

        let part = WirePart {
            name: "avatar".to_string(),
            value: Some("hunter2".to_string()),
            path: None,
        };
        let printed = format!("{:?}", WireBody::Multipart { parts: vec![part] });
        assert!(!printed.contains("hunter2"), "{printed}");
        assert!(printed.contains("avatar"), "{printed}");
    }
}
