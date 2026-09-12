//! The page a site answers with when it has nothing behind it — roadmap task **T124**.
//!
//! **One template for both front ends**, because the page is the same page whichever program is
//! serving it: what differs is how each one is told to reach it, and that lives in the two site
//! templates. A second copy would be a second answer to "what does a new site say", and the copy
//! that drifted would be the one nobody was reading on the day it mattered.
//!
//! **It names nothing about this machine** — the T124 design, D5. A shared site binds its interface
//! address (T74) and answers to an mDNS name (T75), so a phone on the local network can fetch this
//! page. An absolute path and a database account are facts about the machine; the document root as
//! the *row* spells it is the one detail that is both useful and already implied by the site itself,
//! which is why this module is handed that string rather than the joined path
//! [`Served::doc_root`](super::served::Served::doc_root) carries.

use mixengine_proto::ServiceId;

use crate::Result;
use crate::generate::served::ServedKind;

/// The page, compiled in — [`crate::blueprints::gallery`]'s D1, for its reason: what this build
/// ships is a constant of this build, not a document it fetches or a file the user is invited to
/// edit and then owns forever.
const PAGE: &str = include_str!("welcome/page.html");

/// What the template is told to say about one site.
#[derive(Debug, serde::Serialize)]
pub struct WelcomePage<'a> {
    /// The primary domain, which is the one thing on this page the reader already knows.
    pub domain: &'a str,

    /// The site's kind, in the words a person uses rather than the wire's.
    pub kind: &'static str,

    /// The one sentence that is true for this kind.
    pub what_to_do: String,
}

/// What to say about a site of this kind.
///
/// **The sentence comes from the kind and not from a blueprint.** Every site has a kind; a
/// blueprint's own words are an addition, deferred, and a page that could only speak for the sites a
/// blueprint made would be silent in the ordinary case — which is `mix site create` against a
/// directory somebody has not written anything into yet.
///
/// `doc_root` is the row's own relative spelling: empty for a site served from the project root,
/// `public` for Laravel, `web` for Drupal. **Never the joined absolute path** (D5).
///
/// A php-fpm site's upstream is deliberately absent from what this returns: it is a socket path on
/// two of the three systems, which is exactly the kind of fact D5 keeps off a page the local
/// network can fetch. The sentence that kind needs is about a file anyway.
pub fn page<'a>(primary: &'a str, kind: &ServedKind, doc_root: &str) -> WelcomePage<'a> {
    let where_files_go = where_files_go(doc_root);

    let (name, what_to_do) = match kind {
        ServedKind::PhpFpm { .. } => (
            "PHP",
            format!("Put an index.php in {where_files_go} and reload this page."),
        ),
        ServedKind::Static => (
            "static files",
            format!("Put an index.html in {where_files_go} and reload this page."),
        ),
        ServedKind::NodeApp { port } => (
            "a Node application",
            format!(
                "Nothing is listening on port {port}. Start your development server, then reload \
                 this page."
            ),
        ),
        ServedKind::ReverseProxy { upstream } => (
            "a reverse proxy",
            format!(
                "Nothing answered at {upstream}. Start the program that serves it, then reload \
                 this page."
            ),
        ),
    };

    WelcomePage {
        domain: primary,
        kind: name,
        what_to_do,
    }
}

/// How the document root is named in the sentence.
///
/// The empty string is a site served from the project root, which is what `sites.doc_root` holds for
/// one — and "put an index.php in " with nothing after it is the sentence this exists to prevent.
fn where_files_go(doc_root: &str) -> String {
    if doc_root.is_empty() {
        "the project root".to_owned()
    } else {
        doc_root.to_owned()
    }
}

/// The page, rendered.
///
/// # Errors
///
/// [`crate::Error::TemplateBroken`] naming the page: the template is this build's, so a refusal here
/// is a bug of ours rather than a configuration a user can fix.
pub fn render(service: &ServiceId, page: &WelcomePage<'_>) -> Result<String> {
    crate::generate::served::render(PAGE, "welcome/page.html", service, page)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> ServiceId {
        ServiceId::parse("caddy").expect("an id")
    }

    /// **A site served from the project root still gets a sentence.** The row holds an empty string
    /// for one, and the naive rendering ends mid-sentence.
    #[test]
    fn an_empty_doc_root_is_named_rather_than_left_blank() {
        assert_eq!(where_files_go(""), "the project root");
        assert_eq!(where_files_go("public"), "public");
    }

    /// **Each kind says what is actually missing.** A php-fpm site is missing a file; a node-app
    /// site is missing a process, and no file in any directory would change that.
    #[test]
    fn each_kind_says_what_is_actually_missing() {
        let php = page(
            "blog.test",
            &ServedKind::PhpFpm {
                upstream: crate::generate::recipe::Upstream::Tcp(
                    "127.0.0.1:9000".parse().expect("an address"),
                ),
                activator: None,
            },
            "public",
        );
        assert!(php.what_to_do.contains("index.php"), "{}", php.what_to_do);
        assert!(php.what_to_do.contains("public"), "{}", php.what_to_do);

        let node = page("app.test", &ServedKind::NodeApp { port: 3000 }, "");
        assert!(
            node.what_to_do.contains("3000"),
            "the page must name the port nothing is listening on: {}",
            node.what_to_do
        );

        let proxy = page(
            "api.test",
            &ServedKind::ReverseProxy {
                upstream: "http://127.0.0.1:8000".to_owned(),
            },
            "",
        );
        assert!(
            proxy.what_to_do.contains("http://127.0.0.1:8000"),
            "{}",
            proxy.what_to_do
        );
    }

    /// **A php-fpm site's upstream never reaches the page** — D5. It is a socket path on two of the
    /// three systems this product runs on.
    #[test]
    fn a_pools_address_is_not_on_the_page() {
        let rendered = render(
            &id(),
            &page(
                "blog.test",
                &ServedKind::PhpFpm {
                    upstream: crate::generate::recipe::Upstream::Socket(
                        "/run/php-fpm-8.3.sock".into(),
                    ),
                    activator: None,
                },
                "public",
            ),
        )
        .expect("a page");

        assert!(
            !rendered.contains("php-fpm-8.3.sock"),
            "the welcome page leaked the pool's socket:\n{rendered}"
        );
    }

    /// **No absolute path, no database identifier, no service id** — D5, asserted against a
    /// rendering whose inputs would all show up if the template leaked them.
    #[test]
    fn the_rendered_page_names_nothing_about_this_machine() {
        let rendered = render(
            &id(),
            &page("blog.test", &ServedKind::Static, "the project root"),
        )
        .expect("a page");

        for leak in ["/srv/blog", "C:\\", "mariadb", "caddy"] {
            assert!(
                !rendered.contains(leak),
                "the welcome page leaked {leak}:\n{rendered}"
            );
        }
        assert!(rendered.contains("blog.test"), "{rendered}");
    }

    /// **One file, no external reference** — D7. Every one of these would be a broken page on a
    /// machine with no connection, at the exact moment this feature exists to make an impression.
    #[test]
    fn the_page_fetches_nothing() {
        let rendered = render(&id(), &page("blog.test", &ServedKind::Static, "")).expect("a page");

        for fetch in ["http://", "https://", "<script", "<img", "@import"] {
            assert!(
                !rendered.contains(fetch),
                "the welcome page reaches outside itself with {fetch}:\n{rendered}"
            );
        }
    }
}
