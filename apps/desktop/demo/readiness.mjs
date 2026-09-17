/**
 * Whether a scene has finished drawing, judged without looking at what it draws.
 *
 * Ready means: no IPC call in flight and none started for `ipcQuietMs`, and no DOM mutation for
 * `domQuietMs`. A selector would be a claim about the interface — exactly what a redesign breaks.
 * The first sample is never ready, because a quiet period has to be observed, not assumed.
 */
export function createQuietDetector({ ipcQuietMs = 800, domQuietMs = 500, now = Date.now } = {}) {
  let lastCalls = null;
  let lastMutations = null;
  let callsSince = now();
  let mutationsSince = now();

  return ({ inFlight, calls, mutations }) => {
    const t = now();
    if (inFlight > 0 || calls !== lastCalls) {
      lastCalls = calls;
      callsSince = t;
    }
    if (mutations !== lastMutations) {
      lastMutations = mutations;
      mutationsSince = t;
    }
    return inFlight === 0 && t - callsSince >= ipcQuietMs && t - mutationsSince >= domQuietMs;
  };
}
