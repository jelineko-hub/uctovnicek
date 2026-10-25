import { describe, expect, it } from 'vitest';
import { checkDocument, exportFileName, periodRange, previousPeriod, toMrpInvoice, type ExportDocument } from './mrpDocument';

const doc: ExportDocument = {
  id: '0b6f7c1e-2a4d-4c5b-9e8f-1a2b3c4d5e6f',
  kind: 'received_invoice',
  subtype: 'invoice',
  number: null,
  original_number: '2026/0042',
  variable_symbol: '20260042',
  constant_symbol: null,
  issue_date: '2026-10-03',
  tax_point_date: '2026-10-01',
  delivery_date: null,
  due_date: '2026-10-17',
  currency: 'EUR',
  total_amount: '123.00',
  vat_mode: 'standard',
  note: null,
  partner_snapshot: { name: 'Dodávateľ s.r.o.', ico: '36123456' },
  lines: [{ name: 'Materiál', quantity: '1', unit: 'ks', unit_price: '100', vat_rate: '23' }],
};
const settings = { prefix_received: 'FP', prefix_issued: 'FV' };

describe('export do MRP', () => {
  it('bez interného čísla použije prefix radu podľa druhu a UUID dokladu', () => {
    const inv = toMrpInvoice(doc, 'received_invoice', settings, true);
    expect(inv.documentNumber).toBeNull();
    expect(inv.documentNumberPrefix).toBe('FP');
    expect(inv.uuid).toBe(doc.id);
    expect(inv.lines[0]).toMatchObject({ quantity: 1, unitPrice: 100, vatRate: 23 });
    expect(toMrpInvoice({ ...doc, number: 'X1' }, 'received_invoice', settings, true).documentNumberPrefix).toBeNull();
  });

  it('platný doklad prejde bez chýb a upozornení', () => {
    expect(checkDocument(doc, 'received_invoice', settings, true)).toEqual({ errors: [], warnings: [] });
  });

  it('chyby: bez prefixu, bez položiek, bez partnera, cudzia mena, iný druh', () => {
    expect(checkDocument(doc, 'received_invoice', {}, true).errors.join()).toMatch(/prefix/);
    expect(checkDocument({ ...doc, lines: [] }, 'received_invoice', settings, true).errors.join()).toMatch(/položky/);
    expect(checkDocument({ ...doc, partner_snapshot: null }, 'received_invoice', settings, true).errors.join()).toMatch(/partner/);
    expect(checkDocument({ ...doc, currency: 'CZK' }, 'received_invoice', settings, true).errors.join()).toMatch(/CZK/);
    expect(checkDocument(doc, 'issued_invoice', settings, true).errors.join()).toMatch(/druh/);
  });

  it('upozornenia: nesedí suma, dobropis, chýba IČO', () => {
    const w = checkDocument(
      { ...doc, total_amount: 130, subtype: 'credit', partner_snapshot: { name: 'X' } },
      'received_invoice',
      settings,
      true,
    ).warnings.join(' ');
    expect(w).toMatch(/nesedí/);
    expect(w).toMatch(/Dobropis/);
    expect(w).toMatch(/IČO/);
  });

  it('obdobie a názov súboru', () => {
    expect(periodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('2028-02')?.to).toBe('2028-02-29');
    expect(periodRange('2026-13')).toBeNull();
    expect(previousPeriod(new Date('2026-01-15T12:00:00Z'))).toBe('2025-12');
    expect(exportFileName('issued_invoice', '2026-10', doc.id)).toBe('MRP_FV_2026-10_0b6f7c1e.xml');
  });
});
