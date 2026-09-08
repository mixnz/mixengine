/**
 * Pages of MixDB's own that the app sends a user out to.
 *
 * Not in `update.ts`, which owns the release URLs: those are addresses the updater *fetches* and
 * are part of how updating works, while this is a document a user goes to read. They also live on
 * different hosts — the releases are on github.com, this is the project's Pages site — so a reader
 * who assumed one constant could be derived from the other would be wrong.
 */

/**
 * The privacy policy, as declared to the Microsoft Store and to Apple.
 *
 * A store listing points at this URL for as long as the app is listed, so the address is fixed:
 * the page it serves may be rewritten, but it must not move. Its source is `site/privacy/` in this
 * repository, published by the Pages workflow.
 */
export const PRIVACY_POLICY_URL = "https://mixnz.github.io/mixdb/privacy";
