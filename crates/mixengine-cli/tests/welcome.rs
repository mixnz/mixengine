//! What a browser gets from a site with nothing behind it — roadmap task **T124**.
//!
//! The rendering assertions in the two recipes say what the file contains; this says what is
//! *served*, which is the claim the design makes. Three things the text cannot prove on its own:
//! that the exact-path matcher really matches one path, that an application's own 404 survives it,
//! and that the page stops appearing the moment the site has an index — **with no re-render and no
//! reload**, which is what makes "it disappears by itself" a property rather than a promise.
//!
//! **The site starts with an `index.php` and this suite deletes it**, rather than building a fixture
//! with an empty document root. That is the stronger arrangement: the file is the only thing that
//! changes between the two answers, so a page that appeared for any other reason would not appear
//! here, and the front end is never told anything happened.
//!
//! `#[ignore]`d rather than skipped, for `php_site.rs`' reason: a test that quietly returns when it
//! finds no PHP is a green suite that proved nothing on the day the download broke.

mod harness;

use harness::frontend::request_as;
use harness::php_site;

/// The status line of an answer, for a message that says which one came back.
fn status(answer: &str) -> &str {
    answer.lines().next().unwrap_or("no answer at all")
}

/// **A site whose document root has nothing in it answers the welcome page at `/`.**
///
/// The whole of T124 in one request: 200 rather than 404, this site's own name on the page, and
/// `no-store` so that the answer cannot outlive the index that replaces it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a real Caddy and a real PHP — see the module note, and the `caddy` and `php` steps in ci.yml"]
async fn an_empty_site_answers_the_welcome_page_at_the_root() {
    let served = php_site::served(&php_site::runtimes()[..1]).await;
    let site = &served.sites[0];

    std::fs::remove_file(site.root.join("index.php")).expect("the fixture's index");

    let answer = request_as(served.port, "/", &site.domain).unwrap_or_else(|| {
        panic!(
            "the front end answered nothing at all\n{}",
            served.home.daemon_log()
        )
    });

    let rendered = std::fs::read_to_string(
        served
            .home
            .path()
            .join("etc")
            .join("caddy")
            .join("sites")
            .join(format!("{}.caddy", site.domain)),
    )
    .unwrap_or_else(|error| format!("(no site file: {error})"));

    assert!(
        answer.starts_with("HTTP/1.1 200"),
        "a site with nothing in it must not answer 404: {}
--- rendered ---
{rendered}",
        status(&answer)
    );
    assert!(
        answer.contains(&site.domain),
        "the page names the site it is for:\n{answer}"
    );
    assert!(
        answer.to_ascii_lowercase().contains("no-store"),
        "without no-store a cached welcome page outlives the index that replaced it:\n{answer}"
    );
}

/// **And 404 everywhere else** — the T124 design, D3, and the assertion the whole narrow rule exists
/// for. A catch-all error handler passes the test above and fails this one.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a real Caddy and a real PHP"]
async fn an_empty_site_still_answers_404_elsewhere() {
    let served = php_site::served(&php_site::runtimes()[..1]).await;
    let site = &served.sites[0];

    std::fs::remove_file(site.root.join("index.php")).expect("the fixture's index");

    for path in ["/missing", "/api/anything"] {
        let answer = request_as(served.port, path, &site.domain)
            .unwrap_or_else(|| panic!("the front end answered nothing at all for {path}"));

        assert!(
            answer.starts_with("HTTP/1.1 404"),
            "{path} must still be this application's own 404: {}",
            status(&answer)
        );
    }
}

/// **The page stops appearing the moment the site has an index**, with no re-render and no reload —
/// which is what makes the design's D1 *"it disappears by itself"* a property rather than a promise.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a real Caddy and a real PHP"]
async fn writing_an_index_replaces_the_welcome_page() {
    let served = php_site::served(&php_site::runtimes()[..1]).await;
    let site = &served.sites[0];
    let index = site.root.join("index.php");

    std::fs::remove_file(&index).expect("the fixture's index");
    let welcome = request_as(served.port, "/", &site.domain).expect("an answer");
    assert!(
        welcome.to_ascii_lowercase().contains("no-store"),
        "the welcome page did not appear, so this proves nothing about it going away:\n{welcome}"
    );

    std::fs::write(&index, format!("<?php echo \"{}\";\n", site.says)).expect("an index");

    let mine = request_as(served.port, "/", &site.domain).expect("an answer");
    assert!(
        mine.contains(&site.says),
        "the site's own index must answer once it exists:\n{mine}"
    );
    assert!(
        !mine.to_ascii_lowercase().contains("no-store"),
        "the welcome page outlived the index that replaced it:\n{mine}"
    );
}
