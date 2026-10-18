// The QR canvas on the ticket page (registration-web.md W-R24-W-R26). A canvas has no
// text of its own, so it is an image with a label; the code stays as text beside it.
// qr-creator sets the bitmap size (QR_SIZE); the CSS sets the shown size.
import { useEffect, useId, useRef } from "react";
import { drawQr } from "./qr";

export function QrCode({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (canvas.current) drawQr(code, canvas.current);
  }, [code]);

  return (
    <section className="ticket-qr" aria-labelledby={headingId}>
      <h3 id={headingId}>Check-in code</h3>
      <canvas
        ref={canvas}
        className="qr-canvas"
        role="img"
        aria-label={`QR code for ticket ${code}`}
      />
      <p className="ticket-qr-hint">Show this QR code at the entrance.</p>
      <p className="ticket-qr-hint">If the scan does not work, show the ticket code.</p>
    </section>
  );
}
