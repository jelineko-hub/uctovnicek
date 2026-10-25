/**
 * Účtovné obdobia (mesiace). Doklad patrí do obdobia podľa dátumu evidencie, inak DUZP, inak dátumu vystavenia —
 * rovnako ako DB funkcia `uctovnicek.document_period_closed` a filter exportu.
 */

export interface PeriodDates {
  evidence_date?: string | null;
  tax_point_date: string | null;
  issue_date: string | null;
}

export const documentPeriodDate = (d: PeriodDates) => d.evidence_date ?? d.tax_point_date ?? d.issue_date ?? null;

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export const periodOf = (date: string | null | undefined) => (date ? date.slice(0, 7) : null);

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Prvý deň najbližšieho otvoreného obdobia po `period` (na zaevidovanie dokladu z uzavretého mesiaca). */
export function nextOpenEvidenceDate(period: string, closed: Set<string>): string {
  let p = addMonths(period, 1);
  for (let i = 0; i < 120 && closed.has(p); i++) p = addMonths(p, 1);
  return `${p}-01`;
}

/** Posledných `n` mesiacov od `from` (vrátane), od najnovšieho. */
export function recentPeriods(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(from, -i));
}

export const periodLabel = (period: string) => {
  const [y, m] = period.split('-');
  return `${Number(m)}/${y}`;
};
