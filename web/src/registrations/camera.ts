// Camera errors to the state the scan screen shows (registration-web.md W-R30). Pure,
// and not in scanner.ts, so mocking scanner.ts in the screen tests does not mock it.
export type CameraProblem = "denied" | "none" | "insecure" | "other";

// `undefined` means there is no camera API to ask (no secure context or no
// navigator.mediaDevices); otherwise the error of getUserMedia, read by its name.
export function cameraState(error: unknown): CameraProblem {
  if (error === undefined) return "insecure";
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "none";
  return "other";
}
