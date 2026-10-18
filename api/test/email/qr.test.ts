import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { makeQrPng } from "../../src/email/qr.js";

// The ticket QR as a PNG (email-templates.md ET14-ET17, D77, roadmap step
// 34b). Written before the module: ET14-ET16 are the tests first. Real
// node-canvas, no decoder library, no call to the web.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function pixels(png: Buffer) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return (x: number, y: number) => {
    const [r, g, b] = context.getImageData(x, y, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
  };
}

describe("ET14: a PNG from the code (tests first)", () => {
  it("resolves a Buffer with the PNG signature and a 464 x 464 IHDR", async () => {
    const png = await makeQrPng("ABCDEFGH23");
    expect(Buffer.isBuffer(png)).toBe(true);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(464);
    expect(png.readUInt32BE(20)).toBe(464);
  });
});

describe("ET15: the same options as the web (tests first)", () => {
  it("has a white quiet zone, a dark finder square and white just outside it", async () => {
    const at = await pixels(await makeQrPng("ABCDEFGH23"));
    // Quiet zone: the four corners.
    for (const [x, y] of [
      [0, 0],
      [463, 0],
      [0, 463],
      [463, 463],
    ]) {
      expect(at(x, y)).toBe("#FFFFFF");
    }
    // 4 quiet modules of 16 px, then the top-left finder square (fill #101C1A, radius 0).
    expect(at(72, 72)).toBe("#101C1A");
    expect(at(64, 64)).toBe("#101C1A");
    // One pixel left of and above the finder square: still the quiet zone.
    expect(at(63, 72)).toBe("#FFFFFF");
    expect(at(72, 63)).toBe("#FFFFFF");
    expect(at(63, 63)).toBe("#FFFFFF");
  });
});

describe("ET16: deterministic (tests first)", () => {
  it("gives the same bytes for the same code and other bytes for another code", async () => {
    const first = await makeQrPng("ABCDEFGH23");
    const second = await makeQrPng("ABCDEFGH23");
    const other = await makeQrPng("ZYXWVUTS98");
    expect(second.equals(first)).toBe(true);
    expect(other.equals(first)).toBe(false);
  });
});

describe("ET17: failure is loud", () => {
  afterEach(() => {
    vi.doUnmock("canvas");
    vi.resetModules();
  });

  it("rejects when canvas cannot be loaded", async () => {
    vi.resetModules();
    vi.doMock("canvas", () => {
      throw new Error("canvas is not installed");
    });
    const fresh = await import("../../src/email/qr.js");
    await expect(fresh.makeQrPng("ABCDEFGH23")).rejects.toThrow();
  });

  it("rejects when drawing throws", async () => {
    vi.resetModules();
    vi.doMock("canvas", async (importOriginal) => {
      const real = await importOriginal<typeof import("canvas")>();
      return {
        ...real,
        createCanvas: () => {
          throw new Error("no memory");
        },
      };
    });
    const fresh = await import("../../src/email/qr.js");
    await expect(fresh.makeQrPng("ABCDEFGH23")).rejects.toThrow(/no memory/);
  });
});
