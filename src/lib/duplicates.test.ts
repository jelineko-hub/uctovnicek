import { describe, expect, it } from 'vitest';
import { duplicateKey, isSameDocument, sha256Hex } from './duplicates';

const base = {
  partner_snapshot: { ico: '36 123 456' },
  original_number: '2026/0042',
  total_amount: '123.40',
  issue_date: '2026-10-01',
};

describe('duplicates', () => {
  it('rovnaký doklad: IČO + číslo + suma + dátum, bez ohľadu na medzery, veľkosť písmen a typ sumy', () => {
    expect(isSameDocument(base, { ...base, partner_snapshot: { ico: '36123456' }, original_number: '2026/0042 ', total_amount: 123.4 })).toBe(true);
    expect(isSameDocument({ ...base, original_number: 'fa-1' }, { ...base, original_number: 'FA-1' })).toBe(true);
  });

  it('iná suma, číslo, dátum alebo IČO = iný doklad', () => {
    expect(isSameDocument(base, { ...base, total_amount: 123.41 })).toBe(false);
    expect(isSameDocument(base, { ...base, original_number: '2026/0043' })).toBe(false);
    expect(isSameDocument(base, { ...base, issue_date: '2026-10-02' })).toBe(false);
    expect(isSameDocument(base, { ...base, partner_snapshot: { ico: '99999999' } })).toBe(false);
  });

  it('bez čísla alebo sumy sa duplicita nehľadá', () => {
    expect(duplicateKey({ ...base, original_number: null })).toBeNull();
    expect(duplicateKey({ ...base, original_number: '  ' })).toBeNull();
    expect(duplicateKey({ ...base, total_amount: null })).toBeNull();
    expect(isSameDocument({ ...base, total_amount: null }, { ...base, total_amount: null })).toBe(false);
  });

  it('chýbajúce IČO a dátum sa porovnávajú ako prázdne', () => {
    const noIco = { ...base, partner_snapshot: null, issue_date: null };
    expect(isSameDocument(noIco, { ...noIco })).toBe(true);
    expect(isSameDocument(noIco, base)).toBe(false);
  });

  it('sha256Hex', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
