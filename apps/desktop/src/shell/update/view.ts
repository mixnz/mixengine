/** What the Updates pane draws, decided from values alone — T187, spec D9. */

export type PlacementKind = "development" | "swap" | "installer" | "elsewhere";

export type View =
  | "development"
  | "elsewhere"
  | "upToDate"
  | "noBuild"
  | "offer"
  | "skipped"
  | "installing"
  | "handedOver"
  | "finish";

export interface ViewInput {
  current: string;
  placement: { kind: PlacementKind };
  /** The feed's version, and whether it has a build for this machine; null before any read. */
  offered: { version: string; hasBuild: boolean } | null;
  skipped: string | null;
  installing: boolean;
  handedOver: boolean;
  /** What the installer has put on disk, polled while handed over. */
  onDisk: string | null;
}

/** Whether `a` is a later version than `b`, compared as numbers part by part. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export function updateView(input: ViewInput): View {
  const { placement, offered } = input;
  if (placement.kind === "development") return "development";
  if (placement.kind === "elsewhere") return "elsewhere";
  if (input.installing) return "installing";
  if (input.handedOver) {
    return offered && input.onDisk && !isNewer(offered.version, input.onDisk) ? "finish" : "handedOver";
  }
  if (!offered || !isNewer(offered.version, input.current)) return "upToDate";
  if (!offered.hasBuild) return "noBuild";
  if (input.skipped === offered.version) return "skipped";
  return "offer";
}
