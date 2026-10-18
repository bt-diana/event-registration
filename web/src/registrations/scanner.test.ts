// Tests first (registration-web.md W-R37): scanner.ts is the only qr-scanner user.
// qr-scanner is mocked: jsdom has no camera and no canvas decoding.
import QrScanner from "qr-scanner";
import { hasCamera, startScanner } from "./scanner";

const instance = {
  start: vi.fn(() => Promise.resolve()),
  pause: vi.fn(() => Promise.resolve(true)),
  destroy: vi.fn(),
};

vi.mock("qr-scanner", () => {
  const QrScanner = vi.fn(function () {
    return instance;
  }) as unknown as { hasCamera: () => Promise<boolean> };
  QrScanner.hasCamera = vi.fn(() => Promise.resolve(true));
  return { default: QrScanner };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("W-R37: startScanner", () => {
  it("makes one QrScanner on the video with the options and starts it", () => {
    const video = document.createElement("video");
    startScanner(video, () => undefined);
    expect(QrScanner).toHaveBeenCalledTimes(1);
    const [onVideo, , options] = vi.mocked(QrScanner).mock.calls[0];
    expect(onVideo).toBe(video);
    expect(options).toEqual({
      returnDetailedScanResult: true,
      preferredCamera: "environment",
      maxScansPerSecond: 5,
    });
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it("hands the decoded data to onText", () => {
    const onText = vi.fn();
    startScanner(document.createElement("video"), onText);
    const onDecode = vi.mocked(QrScanner).mock.calls[0][1] as unknown as (r: QrScanner.ScanResult) => void;
    onDecode({ data: "K7M2QX9TPA", cornerPoints: [] });
    expect(onText).toHaveBeenCalledWith("K7M2QX9TPA");
  });

  it("stop() stops the stream at once and destroys the scanner", () => {
    const stop = startScanner(document.createElement("video"), () => undefined);
    stop();
    expect(instance.pause).toHaveBeenCalledWith(true);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("a failed start does not throw out of startScanner", async () => {
    instance.start.mockImplementationOnce(() => Promise.reject(new Error("play failed")));
    expect(() => startScanner(document.createElement("video"), () => undefined)).not.toThrow();
    await Promise.resolve();
  });
});

describe("W-R30: hasCamera", () => {
  it("asks QrScanner.hasCamera", async () => {
    vi.mocked(QrScanner.hasCamera).mockResolvedValueOnce(false);
    expect(await hasCamera()).toBe(false);
    expect(QrScanner.hasCamera).toHaveBeenCalledTimes(1);
  });
});
