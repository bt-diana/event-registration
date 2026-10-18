// The only file that imports qr-scanner (registration-web.md W-R37, question 9, D46).
// The screen asks for the camera itself and puts the stream on video.srcObject first:
// with a stream there, QrScanner.start() only plays the video and runs its frame loop.
// The library decodes in its own worker (a separate chunk, loaded with import()) or
// with the browser's BarcodeDetector where it works.
import QrScanner from "qr-scanner";

// Lists the video inputs without a permission prompt.
export function hasCamera(): Promise<boolean> {
  return QrScanner.hasCamera();
}

// Starts decoding the video; onText gets each decoded text. The returned stop() stops
// the stream on the video at once (plain stop() waits 300 ms) and ends the loop and
// the worker.
export function startScanner(video: HTMLVideoElement, onText: (text: string) => void): () => void {
  const scanner = new QrScanner(video, (result) => onText(result.data), {
    returnDetailedScanResult: true,
    preferredCamera: "environment",
    maxScansPerSecond: 5,
  });
  // A failed start leaves the preview without reads; the manual form stays (W-R32).
  scanner.start().catch(() => undefined);
  return () => {
    void scanner.pause(true);
    scanner.destroy();
  };
}
