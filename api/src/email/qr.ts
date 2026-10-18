import type QrCreatorModule from "qr-creator";

// docs/specs/email-templates.md ET14-ET17 (D77). The ticket QR as a PNG for
// the email. The only file that imports `qr-creator` and `canvas`, both lazily,
// so code that never builds a QR never loads the native module. Same options
// as web/src/registrations/qr.ts, so the email QR and the page QR match.
//
// qr-creator is a browser script: when it loads it sets `self.QrCreator` (both
// of its builds, and the CommonJS build exports nothing), and `render` draws
// only onto an element that is `instanceof HTMLCanvasElement`. Node has
// neither global, so `self` is set while the module loads and
// `HTMLCanvasElement` is node-canvas's `Canvas` class while it draws; both are
// put back afterwards.

// 10 characters at level M is version 1: 21 modules, 29 with the 4-module quiet
// zone. 464 = 29 x 16 px per module; the email shows it at half size (232 px).
export const QR_SIZE = 464;

// Under NodeNext the CommonJS types put the class on `.default`.
type QrCreatorType = typeof QrCreatorModule.default;
type Canvas = typeof import("canvas");
type Loaded = { QrCreator: QrCreatorType; Canvas: Canvas["Canvas"]; createCanvas: Canvas["createCanvas"] };

const scope = globalThis as unknown as Record<string, unknown>;

async function loadQrCreator(): Promise<QrCreatorType> {
  const hadSelf = "self" in scope;
  if (!hadSelf) scope.self = globalThis;
  try {
    await import("qr-creator");
  } finally {
    if (!hadSelf) delete scope.self;
  }
  const holder = (hadSelf ? scope.self : scope) as Record<string, unknown>;
  const QrCreator = holder.QrCreator as QrCreatorType | undefined;
  if (typeof QrCreator?.render !== "function") throw new Error("qr-creator did not load");
  return QrCreator;
}

let loading: Promise<Loaded> | null = null;

// Loaded once; a failed load is tried again on the next call (ET17).
function load(): Promise<Loaded> {
  if (loading === null) {
    const started = Promise.all([loadQrCreator(), import("canvas")]).then(([QrCreator, canvas]) => ({
      QrCreator,
      Canvas: canvas.Canvas,
      createCanvas: canvas.createCanvas,
    }));
    loading = started;
    started.catch(() => {
      if (loading === started) loading = null;
    });
  }
  return loading;
}

// The content is the ticket code only: no URL, no prefix, no other data.
// Rejects when canvas cannot be loaded or drawing fails (ET17, ET20).
export async function makeQrPng(code: string): Promise<Buffer> {
  const { QrCreator, Canvas, createCanvas } = await load();
  const canvas = createCanvas(QR_SIZE, QR_SIZE);

  const previous = Object.getOwnPropertyDescriptor(scope, "HTMLCanvasElement");
  scope.HTMLCanvasElement = Canvas;
  try {
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
      canvas as unknown as HTMLElement,
    );
  } finally {
    if (previous) Object.defineProperty(scope, "HTMLCanvasElement", previous);
    else delete scope.HTMLCanvasElement;
  }

  const png = canvas.toBuffer("image/png");
  if (png.length === 0) throw new Error("the QR image is empty");
  return png;
}
