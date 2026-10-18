// The ticket QR (registration-web.md W-R24, W-R26). The only file that imports
// qr-creator (question 9, D46). qr-creator draws only to a canvas, in the page, and
// loads nothing (W-R27).
import QrCreator from "qr-creator";

// 10 characters at level M is version 1: 21 modules, 29 with the 4-module quiet zone.
// 464 = 29 x 16 px per module; the page shows it at half size (232 CSS px).
export const QR_SIZE = 464;

// The content is the ticket code only: no URL, no prefix, no other data.
export function drawQr(code: string, canvas: HTMLCanvasElement): void {
  QrCreator.render(
    {
      text: code,
      ecLevel: "M",
      radius: 0,
      quiet: 4,
      fill: "#101C1A",
      background: "#FFFFFF",
      size: QR_SIZE,
    },
    canvas,
  );
}
