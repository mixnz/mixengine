import type { UpdateHandedOver, UpdateStatus } from "@mixengine/api";

/**
 * Which of the Updates section's states to draw — T88f.
 *
 * Every input is the daemon's: `installed`, `installer`, `offered` and the placement. This only
 * picks the one to show, so the section has no rule of its own about what a status means.
 */
export type UpdatesView = "installed" | "installerOpen" | "offer" | "managed" | "none";

export function updatesView(status: UpdateStatus, handed: UpdateHandedOver | null): UpdatesView {
  // The new binaries are on disk: the only thing left is to restart on them.
  if (status.installed != null) return "installed";

  // Handed to Installer.app and not installed yet: the person is in the installer, or cancelled.
  if (handed !== null) return "installerOpen";

  if (status.offered && status.available != null) return "offer";

  // A copy the .pkg installed reads `managed` on the wire but carries an installer, and is not
  // refused (the design, D3).
  if (status.placement.kind === "managed" && status.installer == null) return "managed";

  return "none";
}
