/**
 * Finding a newer MixDB, fetching it, and putting it in place.
 *
 * The whole exchange happens through Tauri's updater plugin, which reads a small `latest.json`
 * published beside the installers, downloads the bundle for this platform and checks it against the
 * public key baked into `tauri.conf.json` before a byte of it is executed. That signature is
 * MixDB's own, and has nothing to do with the Authenticode or Developer ID certificates the app
 * still lacks — which is why the update path can be trusted even though the first install makes
 * Windows and macOS complain.
 *
 * Downloading and installing are kept as two separate steps on purpose. Installing closes MixDB,
 * and a user with unsaved query results should be the one who decides when that happens: the
 * download runs quietly in the background, and only when it is on disk does anything ask.
 *
 * Three small keys in localStorage, beside the theme and the language, remember what the user
 * decided about a version and when the last check ran.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";

const REPO = "mixnz/mixdb";

/** Where a user is sent when the automatic path fails them — a `.deb` install, a locked-down
 *  machine, a download that will not complete. */
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** The version the user asked not to be told about again. */
const SKIPPED_KEY = "mixdb-skipped-version";

/** When the last check finished, so Settings can say how fresh its answer is. */
const LAST_CHECK_KEY = "mixdb-update-checked-at";

/**
 * How long after launch the startup check runs.
 *
 * The first seconds belong to the connection form: a user opening MixDB is going somewhere, and a
 * panel sliding in over that is an interruption rather than news. By the time this fires they have
 * either connected or are reading the form, and either way a corner of the window is free.
 */
export const STARTUP_CHECK_DELAY_MS = 6000;

/** How long the check waits on the network before giving up, in milliseconds. Nothing depends on
 *  the answer, so a launch must not be spent waiting for it. */
const CHECK_TIMEOUT_MS = 20000;

/** A release as this app cares about it. */
export interface Release {
  /** The version being offered, e.g. `0.2.0`. */
  version: string;
  /** The release notes, as written on GitHub. Markdown, shown as plain text. */
  notes: string;
  /** When it was published, in whatever form the manifest gave — possibly nothing at all. */
  publishedAt: string;
}

/**
 * What the update is doing, or what became of it.
 *
 * `available` through `installing` is one path in one direction; there is no way back to
 * `available` from `downloaded` short of a fresh check.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

/**
 * Whether the plugin's handle is in someone's hands: a download running, a bundle on disk waiting
 * for the restart, an install under way.
 *
 * A check closes that handle and puts a new one in its place, so it must not run while any of
 * these is true. `downloaded` is the one this used to be missing: the button stayed enabled with
 * the bundle already fetched, and pressing it threw the download away and dropped the offer back
 * to "available" — the user had waited for the whole thing and was asked to wait for it again.
 */
export function holdsUpdate(status: UpdateStatus): boolean {
  return status === "downloading" || status === "downloaded" || status === "installing";
}

/**
 * Whether there is an update to tell the user about — the dot on the brand button, the panel in
 * the corner.
 *
 * `checking` is in the list because a re-check does not un-find what was found: the release being
 * shown is still the release, and the handle is still there. Without it the dot and the panel blink
 * off for the length of the request and come back, which reads as a bug about a version rather than
 * a check about to answer.
 *
 * An `error` only counts when there was already a release to fail at. A check that failed on its
 * own is Settings' business and not an interruption, which is what `hasRelease` is doing here.
 */
export function isPending(status: UpdateStatus, hasRelease: boolean, isSkipped: boolean): boolean {
  if (!hasRelease || isSkipped) return false;
  return (
    status === "available" || status === "checking" || status === "error" || holdsUpdate(status)
  );
}

/** The version the user has told MixDB to stop mentioning, if any. */
export function readSkippedVersion(): string {
  return localStorage.getItem(SKIPPED_KEY) ?? "";
}

/** Silences one version. A later one still gets announced — this is "not this one", not "never". */
export function writeSkippedVersion(version: string): void {
  localStorage.setItem(SKIPPED_KEY, version);
}

/** Undoes a skip, so Settings can offer the news back. */
export function clearSkippedVersion(): void {
  localStorage.removeItem(SKIPPED_KEY);
}

/** When the last successful check happened, or null before the first one. */
export function readLastChecked(): number | null {
  const stored = Number(localStorage.getItem(LAST_CHECK_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export function writeLastChecked(at: number): void {
  localStorage.setItem(LAST_CHECK_KEY, String(at));
}

/** Opens the releases page in the user's browser, for when the automatic path cannot be taken. */
export function openReleasesPage(): Promise<void> {
  return openUrl(RELEASES_PAGE);
}

/** The update as the app holds it: what was found, how far it has got, and what can be done next. */
export interface UpdateCheck {
  /** The running version, empty until the first check has answered. */
  current: string;
  status: UpdateStatus;
  /** The newer release, when there is one. Null while up to date. */
  release: Release | null;
  /** Why the last check, download or install failed, in the plugin's own words. */
  error: string;
  lastChecked: number | null;
  /** Whether the offered release is one the user has told MixDB to stop mentioning. */
  skipped: boolean;
  /** How much of the bundle is on disk, 0 to 1 — or -1 when the server did not say how big it is. */
  progress: number;
  /** An update the user has neither skipped nor finished — what lights the button in the tab bar. */
  pending: boolean;
  /** The same, and not yet waved away — what shows the panel in the corner. */
  announcing: boolean;
  /** Whether *Check now* may be pressed: no check already out, and nothing holding the handle a
   *  check would replace. Answered here rather than read off `status` by whoever draws the button,
   *  because the rule is about what the hook is doing with that handle. */
  canCheck: boolean;
  check: () => void;
  /** Fetches the bundle. The app carries on running throughout. */
  download: () => void;
  /** Puts it in place and restarts. Everything unsaved goes with it, so this is only ever called
   *  from a button the user pressed. */
  install: () => void;
  /** Hides the panel for this run, leaving the button lit. A download in flight carries on. */
  dismiss: () => void;
  /** Hides the panel and the light, for this version only. */
  skip: () => void;
  /** Takes a skip back, so this version is offered again. */
  unskip: () => void;
  /** The way out when the automatic path fails: the release page, and its instructions. */
  openPage: () => void;
}

/**
 * Runs the check once at launch and whenever asked, and drives the download and the install.
 *
 * One instance of this lives in App, which passes it to both the panel and Settings: two hooks
 * would mean two checks, two downloads, and two disagreeing answers about what the user has
 * already dismissed.
 */
export function useUpdateCheck(): UpdateCheck {
  const [current, setCurrent] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState<number | null>(readLastChecked);
  const [skipped, setSkipped] = useState(readSkippedVersion);
  const [dismissed, setDismissed] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);

  /** The plugin's handle on the update: the thing that knows how to fetch and install it. Held
   *  across renders because the download and the install happen long after the check that found
   *  it, and each is a separate press of a separate button. */
  const found = useRef<Update | null>(null);

  /** Which check is the current one. A manual check started from Settings while an earlier one is
   *  still in flight makes the earlier one's answer stale, and stale answers are dropped — the
   *  plugin has no way to cancel a request once it is out. */
  const generation = useRef(0);

  /* The running version, asked for once and taken from the bundle rather than from package.json so
     it is the one the installed app actually reports. Settings shows it before any check has run. */
  useEffect(() => {
    let alive = true;
    getVersion().then((version) => {
      if (alive) setCurrent(version);
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    setStatus("checking");
    setError("");

    (async () => {
      try {
        const update = await checkForUpdate({ timeout: CHECK_TIMEOUT_MS });
        if (generation.current !== mine) {
          // Someone asked again while this was out. Its handle would leak otherwise.
          await update?.close();
          return;
        }

        void found.current?.close();
        found.current = update;

        const at = Date.now();
        writeLastChecked(at);
        setLastChecked(at);
        setDownloaded(0);
        setTotal(0);

        if (update === null) {
          setRelease(null);
          setStatus("upToDate");
        } else {
          setCurrent(update.currentVersion);
          setRelease({
            version: update.version,
            notes: update.body?.trim() ?? "",
            publishedAt: update.date ?? "",
          });
          setStatus("available");
        }
        // A version that has appeared since the last check is news again, even if the previous one
        // was waved away in this same run.
        setDismissed(false);
      } catch (e) {
        if (generation.current !== mine) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  /* The startup check, delayed so it does not land on top of the connection form. In development
     StrictMode mounts twice; the cleanup cancels the first timer, so only one check goes out. */
  useEffect(() => {
    const timer = window.setTimeout(check, STARTUP_CHECK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [check]);

  const download = useCallback(() => {
    const update = found.current;
    if (update === null) return;
    setStatus("downloading");
    setError("");
    setDownloaded(0);
    setTotal(0);

    (async () => {
      try {
        await update.download((event) => {
          switch (event.event) {
            case "Started":
              // Absent when the server sends the bundle chunked, which is why progress can be
              // indeterminate rather than simply zero.
              setTotal(event.data.contentLength ?? 0);
              break;
            case "Progress":
              setDownloaded((soFar) => soFar + event.data.chunkLength);
              break;
            case "Finished":
              break;
          }
        });
        setStatus("downloaded");
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const install = useCallback(() => {
    const update = found.current;
    if (update === null) return;
    setStatus("installing");
    setError("");

    (async () => {
      try {
        await update.install();
        // Windows rarely reaches the next line: the installer has to replace an executable that is
        // running, so it closes MixDB and reopens it once it is done. macOS and Linux swap the
        // files underneath the running process, which then has to be told to start again.
        await relaunch();
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const version = release?.version ?? "";
  const isSkipped = version !== "" && version === skipped;
  const pending = isPending(status, release !== null, isSkipped);

  return {
    current,
    status,
    release,
    error,
    lastChecked,
    skipped: isSkipped,
    progress: total > 0 ? Math.min(downloaded / total, 1) : -1,
    pending,
    announcing: pending && !dismissed,
    canCheck: status !== "checking" && !holdsUpdate(status),
    check,
    download,
    install,
    dismiss: useCallback(() => setDismissed(true), []),
    skip: useCallback(() => {
      if (version === "") return;
      writeSkippedVersion(version);
      setSkipped(version);
    }, [version]),
    unskip: useCallback(() => {
      clearSkippedVersion();
      setSkipped("");
      setDismissed(false);
    }, []),
    openPage: useCallback(() => {
      void openReleasesPage();
    }, []),
  };
}
