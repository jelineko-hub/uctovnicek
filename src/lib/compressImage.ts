/**
 * Zmenší fotku dokladu v prehliadači pred nahratím (mobil fotí 4000 px+ a 5–10 MB).
 * Na vyťaženie stačí ~2400 px na dlhšej strane. PDF a nepodporované formáty vráti bez zmeny.
 */
export async function compressImage(file: File, maxSide = 2400, quality = 0.85): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2_000_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Kľúč v Storage nesmie obsahovať diakritiku ani špeciálne znaky. */
export function safeFileName(name: string): string {
  const base = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return base.replace(/^-+|-+$/g, '').slice(-80) || 'doklad';
}
