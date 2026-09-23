-- Whether a site's plaintext address redirects to its HTTPS one — roadmap task T98.
--
-- **Off by default, on the same row `https_enabled` lives on.** T51's D9 decided no redirect, for
-- every site that does not ask for one; this is that ask, per site, not a front-end-wide setting.
--
-- **The CHECK references `https_enabled` directly, which SQLite allows from an `ALTER TABLE ADD
-- COLUMN`** — measured before this migration was written, because `0012_site_sharing.sql`'s own
-- comment says SQLite refuses a table-level CHECK added after the fact, and the restriction there is
-- on the table-level form, not on a column-level CHECK naming a column already in the row. A site
-- can never carry `https_redirect = 1` while `https_enabled = 0`, enforced here rather than trusted
-- to every future caller that writes this table.
ALTER TABLE sites ADD COLUMN https_redirect INTEGER NOT NULL DEFAULT 0
    CHECK (https_redirect = 0 OR https_enabled = 1);
