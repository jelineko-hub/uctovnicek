/**
 * DPH z položiek dokladu. Jediný zdroj výpočtu pre formulár dokladu aj exporty.
 * Položky majú cenu za MJ BEZ DPH; DPH sa zaokrúhľuje za každú sadzbu (nie za riadok).
 */

export interface VatLine {
  quantity: number;
  unitPrice: number;        // bez DPH
  vatRate: number;          // %
  discountPercent?: number;
}

export interface VatRow {
  rate: number;
  base: number;
  vat: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineNet(l: VatLine): number {
  return l.unitPrice * (1 - (l.discountPercent ?? 0) / 100) * l.quantity;
}

/** Rozpis DPH podľa sadzieb, zoradený od najvyššej. */
export function vatSummary(lines: VatLine[]): VatRow[] {
  const by = new Map<number, number>();
  for (const l of lines) by.set(l.vatRate, (by.get(l.vatRate) ?? 0) + lineNet(l));
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => {
      const b = round2(base);
      return { rate, base: b, vat: round2((b * rate) / 100) };
    });
}

export function totals(lines: VatLine[]) {
  const rows = vatSummary(lines);
  const base = round2(rows.reduce((a, r) => a + r.base, 0));
  const vat = round2(rows.reduce((a, r) => a + r.vat, 0));
  return { rows, base, vat, total: round2(base + vat) };
}

/** Prepočet ceny s DPH na cenu bez DPH (pre doklady, kde sú položky uvedené s DPH). */
export function netFromGross(gross: number, vatRate: number): number {
  return gross / (1 + vatRate / 100);
}
