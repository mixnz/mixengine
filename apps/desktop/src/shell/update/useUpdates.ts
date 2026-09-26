import { useCallback, useEffect, useState } from "react";
import { useWindowFocused } from "../../core/windowFocus";
import * as api from "./api";
import { updateView, type View } from "./view";

/** 30 seconds after the window is drawn, then every 24 hours — spec D6. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 24 * 60 * 60 * 1000;
/** How often the installer's result is looked for while it is open — spec D5. */
const DISK_POLL_MS = 3_000;

export interface Updates {
  status: api.UpdateStatus | null;
  view: View;
  progress: api.Progress | null;
  handedOver: api.HandedOver | null;
  checking: boolean;
  /** "Remind me later": hides the offer until the next window start. */
  later: boolean;
  /** A rejected command, as the backend sent it; the pane translates it. */
  error: unknown;
  /** Why *Check now* could not read the feed. */
  checkFailure: string | null;
  checkNow: () => Promise<void>;
  setAutomatic: (on: boolean) => Promise<void>;
  install: () => Promise<void>;
  skip: () => Promise<void>;
  remindLater: () => void;
  finish: () => Promise<void>;
  backFromHandover: () => void;
  dismissError: () => void;
}

/**
 * MixLab's updater, for the shell: mounted once in `Workspace`, and handed to the Updates pane and
 * the Settings button. Checks on its own only while the automatic switch is on; never downloads or
 * installs without a click (spec D6).
 *
 * `watching` is whether somebody can see the result of an installer: the poll for the version on
 * disk runs only then, so a person who walked away leaves no timer behind.
 */
export function useUpdates(watching: boolean): Updates {
  const [status, setStatus] = useState<api.UpdateStatus | null>(null);
  const [progress, setProgress] = useState<api.Progress | null>(null);
  const [handedOver, setHandedOver] = useState<api.HandedOver | null>(null);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [checkFailure, setCheckFailure] = useState<string | null>(null);
  const focused = useWindowFocused();

  useEffect(() => {
    const quietly = () => void api.updateCheck(false).then(setStatus).catch(() => undefined);
    void api
      .updateStatus()
      .then(setStatus)
      .catch(() => undefined);
    const first = window.setTimeout(quietly, FIRST_CHECK_MS);
    const every = window.setInterval(quietly, EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  const polling = handedOver !== null && watching && focused;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(
      () =>
        void api
          .updateVersionOnDisk()
          .then(setOnDisk)
          .catch(() => undefined),
      DISK_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [polling]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e);
    }
  }, []);

  const view: View =
    status === null
      ? "upToDate"
      : updateView({
          current: status.current,
          placement: status.placement,
          offered: status.feed && { version: status.feed.version, hasBuild: status.feed.hasBuild },
          skipped: status.skipped,
          installing: installing || status.installing,
          handedOver: handedOver !== null,
          onDisk,
        });

  return {
    status,
    view,
    progress,
    handedOver,
    checking,
    later,
    error,
    checkFailure,
    checkNow: () =>
      run(async () => {
        setChecking(true);
        setCheckFailure(null);
        try {
          const next = await api.updateCheck(true);
          setStatus(next);
          setCheckFailure(next.failure);
        } finally {
          setChecking(false);
        }
      }),
    setAutomatic: (on) =>
      run(async () => {
        await api.updateSetAutomatic(on);
        setStatus(await api.updateStatus());
      }),
    install: () =>
      run(async () => {
        if (status?.placement.kind === "installer") {
          try {
            setHandedOver(await api.updateHandOver(setProgress));
          } finally {
            setProgress(null);
          }
          return;
        }
        setInstalling(true);
        try {
          // Success ends in a relaunch; this only comes back on failure.
          await api.updateInstall(setProgress);
        } finally {
          setInstalling(false);
          setProgress(null);
        }
      }),
    skip: () =>
      run(async () => {
        if (!status?.feed) return;
        await api.updateSkip(status.feed.version);
        setStatus(await api.updateStatus());
      }),
    remindLater: () => setLater(true),
    finish: () => run(api.updateFinish),
    backFromHandover: () => {
      setHandedOver(null);
      setOnDisk(null);
    },
    dismissError: () => setError(null),
  };
}
