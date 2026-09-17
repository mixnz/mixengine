/**
 * Whether a scene has finished drawing, judged without looking at what it draws.
 *
 * Ready means: the app has mounted into `demo.html`'s `#root`, no IPC call is in flight and none
 * started for `ipcQuietMs`, and no DOM mutation for `domQuietMs`. A selector would be a claim about
 * the interface — exactly what a redesign breaks; `#root` is the demo's own markup.
 *
 * Mounting is its own condition because a cold Vite server can spend seconds optimising
 * dependencies before the bundle runs at all, and a page doing nothing yet is perfectly quiet.
 * The first sample is never ready, because a quiet period has to be observed, not assumed.
 */
export function createQuietDetector({ ipcQuietMs = 800, domQuietMs = 500, now = Date.now } = {}) {
  let lastCalls = null;
  let lastMutations = null;
  let callsSince = now();
  let mutationsSince = now();

  return ({ inFlight, calls, mutations, mounted = true }) => {
    const t = now();
    if (!mounted || inFlight > 0 || calls !== lastCalls) {
      lastCalls = calls;
      callsSince = t;
    }
    if (!mounted || mutations !== lastMutations) {
      lastMutations = mutations;
      mutationsSince = t;
    }
    return mounted && inFlight === 0 && t - callsSince >= ipcQuietMs && t - mutationsSince >= domQuietMs;
  };
}
