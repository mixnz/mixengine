/** The databases MongoDB keeps for itself: users and roles in `admin`, the oplog in `local`, and
 * the sharding metadata in `config`. Dumping one is meaningless and dropping one breaks the
 * deployment, so the actions that act on a whole database stay switched off while one is selected.
 */
const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

/** Whether the database belongs to the server rather than to the user. MongoDB database names are
 * case-sensitive, but a name differing only in case is refused as a duplicate, so it is compared
 * folded here too. */
export function isMongoSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database.toLowerCase());
}
