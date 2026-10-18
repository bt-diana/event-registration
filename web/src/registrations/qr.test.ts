// Tests first (registration-web.md W-R24, W-R27): drawQr hands only the ticket code to
// qr-creator, with the options of W-R24 and W-R26. qr-creator is mocked: jsdom cannot
// draw on a canvas, and the test checks what is asked, not the pixels.
import QrCreator from "qr-creator";
import { drawQr } from "./qr";

vi.mock("qr-creator", () => ({ default: { render: vi.fn() } }));

const render = vi.mocked(QrCreator.render);

afterEach(() => {
  render.mockClear();
  vi.unstubAllGlobals();
});

describe("W-R24: drawQr", () => {
  it("draws the ticket code only, error level M, square modules, 4-module quiet zone", () => {
    const canvas = document.createElement("canvas");
    drawQr("K7M2QX9TPA", canvas);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]).toEqual([
      {
        text: "K7M2QX9TPA",
        ecLevel: "M",
        radius: 0,
        quiet: 4,
        fill: "#101C1A",
        background: "#FFFFFF",
        size: 464,
      },
      canvas,
    ]);
    expect(render.mock.calls[0][1]).toBe(canvas);
  });

  it("the text is exactly the code: no URL, no prefix, no other data", () => {
    const canvas = document.createElement("canvas");
    drawQr("H4Z8WR5NCD", canvas);
    expect(render.mock.calls[0][0].text).toBe("H4Z8WR5NCD");
  });
});

describe("W-R27: no network for the QR", () => {
  it("drawing makes no fetch", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    drawQr("K7M2QX9TPA", document.createElement("canvas"));
    drawQr("K7M2QX9TPA", document.createElement("canvas"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
