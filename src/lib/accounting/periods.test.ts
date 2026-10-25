import { describe, expect, it } from 'vitest';
import { addMonths, documentPeriodDate, nextOpenEvidenceDate, periodOf, recentPeriods } from './periods';

describe('obdobia', () => {
  it('dátum obdobia: evidencia → DUZP → vystavenie', () => {
    expect(documentPeriodDate({ evidence_date: '2026-11-01', tax_point_date: '2026-09-30', issue_date: '2026-10-02' })).toBe('2026-11-01');
    expect(documentPeriodDate({ tax_point_date: '2026-09-30', issue_date: '2026-10-02' })).toBe('2026-09-30');
    expect(documentPeriodDate({ tax_point_date: null, issue_date: '2026-10-02' })).toBe('2026-10-02');
    expect(periodOf('2026-09-30')).toBe('2026-09');
  });

  it('najbližšie otvorené obdobie preskočí uzavreté a prelom roka', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(nextOpenEvidenceDate('2026-11', new Set(['2026-12', '2027-01']))).toBe('2027-02-01');
    expect(nextOpenEvidenceDate('2026-09', new Set())).toBe('2026-10-01');
    expect(recentPeriods('2026-02', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });
});
