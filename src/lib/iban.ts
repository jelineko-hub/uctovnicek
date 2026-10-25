/** IBAN: normalizácia a kontrola (ISO 13616, mod 97). */

export function normalizeIban(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, '').toUpperCase();
}

export function isValidIban(input: string | null | undefined): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('SK') && iban.length !== 24) return false;
  if (iban.startsWith('CZ') && iban.length !== 24) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Formát na zobrazenie po štvoriciach: „SK31 1200 0000 …". */
export function formatIban(input: string | null | undefined): string {
  return normalizeIban(input).replace(/(.{4})(?=.)/g, '$1 ');
}
