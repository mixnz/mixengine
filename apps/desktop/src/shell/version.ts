/**
 * What version this is, and where a newer one comes from.
 *
 * **What this file replaces.** `update.ts` was MixDB's own updater: a check, a download, an install,
 * a skip list and three `localStorage` keys, all driving `tauri-plugin-updater` against a feed at
 * `mixnz/mixdb`. T106 made MixEngine's updater the only one — one signed feed, one key, one payload,
 * and `update.status | check | decide | apply` on the daemon — so the plugin, its key and its feed
 * are gone and there is nothing here left to drive.
 *
 * What is kept is what a person opening MixLab's Settings actually needs: the running version, and
 * where updates come from. The pane that shows it is a signpost, because the pane a MixLab user
 * opens first is the shell's and the pane that updates MixEngine is inside a tab.
 */

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO = "mixnz/mixengine";

/** Where a user is sent when the automatic path is not available to them — a `.deb` install, a
 *  locked-down machine, a copy something else installed. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** Opens the releases page in the user's browser. */
export function openReleasesPage(): Promise<void> {
  return openUrl(RELEASES_PAGE);
}

/**
 * The running version, empty until the bundle has answered.
 *
 * Taken from the bundle rather than from `package.json` so it is the one the installed app actually
 * reports — which, since T104, is the workspace's.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let alive = true;
    void getVersion().then((answer) => {
      if (alive) setVersion(answer);
    });
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
