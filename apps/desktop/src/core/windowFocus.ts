import { useEffect, useState } from "react";

/**
 * Whether this window has the person's attention right now, which is focus.
 *
 * For a screen that holds something open only while somebody is looking: MixEngine samples every
 * second while `/metrics` is held, so a screen that kept it open behind another application would
 * keep the daemon doing so for nobody. The tray panel answers the same question from Tauri's own
 * `onFocusChanged`; a screen of the main window reads the DOM's, which is the same fact without a
 * round trip.
 */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    // Read again: focus may have moved between the first render and these listeners.
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}
