/**
 * eKasa UID dokladu (online pokladnica): `O-` + 32 hex znakov, napr. `O-9B1B3545701B46F39B3545701BE6F3A6`.
 * Čisté funkcie — používa ich prehliadač (QR) aj server (vyťaženie, lookup).
 */

const UID = /^O-[0-9A-F]{32}$/;

/** Normalizuje UID z textu (OCR, ručné zadanie): medzery preč, veľké písmená, O→0 / I,L→1 v hex časti. */
export function normalizeEkasaUid(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.replace(/\s+/g, '').toUpperCase().replace(/^UID:/, '');
  const m = /^[O0]-?(.+)$/.exec(s);
  if (!m) return null;
  const hex = m[1].replace(/O/g, '0').replace(/[IL]/g, '1');
  const uid = `O-${hex}`;
  return UID.test(uid) ? uid : null;
}

/** UID z obsahu QR kódu bločku, alebo null (napr. offline doklad bez UID). */
export function uidFromQr(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /O-[0-9A-F]{32}/i.exec(text.replace(/\s+/g, ''));
  return m ? m[0].toUpperCase() : null;
}
