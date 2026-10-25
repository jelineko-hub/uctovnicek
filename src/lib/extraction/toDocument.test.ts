import { describe, expect, it } from 'vitest';
import type { ExtractedDocument } from './schema';
import { toDocument } from './toDocument';

const empty = {
  name: null, ico: null, dic: null, ic_dph: null, street: null, city: null, zip: null, country_code: null, iban: null,
};

const base: ExtractedDocument = {
  kind: 'received_invoice',
  subtype: 'invoice',
  supplier: { ...empty, name: ' Dodávateľ s.r.o. ', ico: '12 345 678', ic_dph: 'sk 2020123456', iban: 'sk31 1200 0000 1987 4263 7541' },
  customer: { ...empty, name: 'Moja firma', ico: '87654321' },
  number: 'FA-2026/45',
  variable_symbol: 'VS 202645',
  constant_symbol: null,
  ekasa_uid: null,
  issue_date: '2026-10-20',
  tax_point_date: '2026-02-30',
  due_date: null,
  currency: 'eur',
  total_amount: 123.004,
  payment_method: 'transfer',
  vat_mode: 'standard',
  vat_summary: [{ rate: 23, base: 100, vat: 23 }],
  lines: [
    { name: 'Materiál', quantity: 0, unit: 'ks', unit_price: 100.0000004, vat_rate: 23 },
    { name: '  ', quantity: 1, unit: null, unit_price: 0, vat_rate: 0 },
  ],
  confidence: 1.4,
  notes: null,
};

describe('toDocument', () => {
  it('normalizuje čísla, IBAN, menu a neplatné dátumy', () => {
    const { patch } = toDocument(base, '87654321');
    expect(patch.partner_snapshot).toMatchObject({
      name: 'Dodávateľ s.r.o.', ico: '12345678', ic_dph: 'SK2020123456', iban: 'SK3112000000198742637541',
    });
    expect(patch.variable_symbol).toBe('202645');
    expect(patch.currency).toBe('EUR');
    expect(patch.tax_point_date).toBeNull(); // 30. február neexistuje
    expect(patch.total_amount).toBe(123);
    expect(patch.ocr_confidence).toBe(1);
  });

  it('podľa IČO firmy prepne na vydanú faktúru a partnerom je odberateľ', () => {
    const { patch } = toDocument(base, '12345678');
    expect(patch.kind).toBe('issued_invoice');
    expect(patch.partner_snapshot.name).toBe('Moja firma');
  });

  it('vynechá prázdne riadky a nulové množstvo nahradí 1', () => {
    const { lines } = toDocument(base, null);
    expect(lines).toEqual([{ position: 0, name: 'Materiál', quantity: 1, unit: 'ks', unit_price: 100, vat_rate: 23 }]);
  });

  it('IBAN firmy ako dodávateľský účet → vydaná faktúra (keď IČO nerozhodne)', () => {
    const noIco = { ...base, customer: { ...base.customer, ico: null }, supplier: { ...base.supplier, ico: null } };
    expect(toDocument(noIco, '87654321', ['SK31 1200 0000 1987 4263 7541']).patch.kind).toBe('issued_invoice');
    expect(toDocument(noIco, '87654321', ['SK0000000000000000000000']).patch.kind).toBe('received_invoice');
    // IČO má prednosť pred IBAN-om
    expect(toDocument(base, '87654321', ['SK3112000000198742637541']).patch.kind).toBe('received_invoice');
  });

  it('bloček sa počíta zo súm s DPH', () => {
    expect(toDocument({ ...base, kind: 'receipt' }, null).patch.prices_with_vat).toBe(true);
    expect(toDocument(base, null).patch.prices_with_vat).toBe(false);
  });
});
