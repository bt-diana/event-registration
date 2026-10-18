// Tests first (registration-web.md W-R30): camera errors to the shown state.
import { cameraState } from "./camera";

function domError(name: string): DOMException {
  return new DOMException("camera", name);
}

describe("W-R30: cameraState", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "none"],
    ["OverconstrainedError", "none"],
    ["NotReadableError", "other"],
    ["AbortError", "other"],
  ])("%s is %s", (name, state) => {
    expect(cameraState(domError(name))).toBe(state);
  });

  it("no camera API (undefined) is insecure", () => {
    expect(cameraState(undefined)).toBe("insecure");
  });

  it("anything else is other", () => {
    expect(cameraState(new Error("boom"))).toBe("other");
    expect(cameraState("Camera not found.")).toBe("other");
  });
});
