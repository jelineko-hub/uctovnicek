/**
 * Prečítanie QR kódu z fotky v prehliadači (bloček eKasa). Najprv natívny `BarcodeDetector`
 * (Chrome/Android, Safari 17+), inak knižnica jsQR na zmenšenom obrázku. Pri chybe vráti null.
 */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmap): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

async function withJsQr(bitmap: ImageBitmap): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  // QR na fotke bločku býva malý → skúsiť menšie (rýchle) aj väčšie rozlíšenie.
  for (const max of [1200, 2400]) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;
    if (scale === 1) break;
  }
  return null;
}

export async function readQrFromImage(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Detector) {
      try {
        const codes = await new Detector({ formats: ['qr_code'] }).detect(bitmap);
        const hit = codes.find((c) => c.rawValue)?.rawValue;
        if (hit) return hit;
      } catch {
        // nepodporovaný formát / prehliadač → jsQR
      }
    }
    return await withJsQr(bitmap);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
