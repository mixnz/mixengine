-- T135. One site, many backends: a site is a kind plus an ordered set of path routes, and the kind
-- is what answers whatever no route matched.
--
-- `position` is what a person typed, kept so a listing can show it back; it is NOT what decides
-- which route wins. Overlaps are resolved by specificity where the configuration is rendered --
-- longest path first -- so that Caddy, whose handlers are taken in order, and nginx, which has
-- location rules of its own, reach the same answer without either being asked to.
--
-- `php_service_id` is `ON DELETE SET NULL` on `sites.php_service_id`'s precedent: a
-- `service.delete --force` may cross a route's declaration, and NULL here means "the pool this route
-- named has been deleted". The render skips that one route with a warning and serves the rest of the
-- site, where a *site* with no pool is dropped whole -- a route is one prefix of a site that still
-- has a root, a kind and possibly four other routes.
--
-- `config_json` holds whatever the target carries beyond those two columns, built with `serde_json`,
-- so escaping an upstream that has a path in it is nobody's problem here.
CREATE TABLE site_routes (
    id             INTEGER PRIMARY KEY,
    site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    path           TEXT    NOT NULL,
    target         TEXT    NOT NULL,
    php_service_id TEXT             REFERENCES services(id) ON DELETE SET NULL,
    config_json    TEXT    NOT NULL DEFAULT '{}',

    CONSTRAINT site_routes_target CHECK (target IN ('proxy', 'php-fpm', 'static')),

    -- The daemon refuses far more than this (a whitelist per segment, a length, dot segments); what
    -- is here is the half the schema can hold on its own, including the one the design turns on --
    -- `/` is answered by the site's kind and by nothing else.
    CONSTRAINT site_routes_path CHECK (path <> '' AND path <> '/' AND path LIKE '/%')
) STRICT;

-- One path answers once on one site. Also the index the cascade reads.
CREATE UNIQUE INDEX site_routes_site_path ON site_routes (site_id, path);
