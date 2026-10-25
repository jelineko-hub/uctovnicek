import { describe, expect, it } from 'vitest';
import { buildMrpXml, MrpExportError, toCp1250Safe, vatGroups, type MrpInvoice } from './xml';

const partner = {
  ico: '12345678',
  dic: '2020123456',
  icDph: 'SK2020123456',
  name: 'Dodávateľ s.r.o.',
  street: 'Hlavná 1',
  city: 'Žilina',
  zip: '01001',
  countryCode: 'SK',
};

const invoice: MrpInvoice = {
  documentNumber: 'FP2610001',
  originalNumber: '2026100045',
  issueDate: '2026-10-20',
  taxPointDate: '2026-10-20',
  dueDate: '2026-11-03',
  variableSymbol: '2026100045',
  partner,
  lines: [
    { description: 'Materiál', quantity: 2, unit: 'ks', unitPrice: 100, vatRate: 23 },
    { description: 'Potraviny', quantity: 1, unit: 'ks', unitPrice: 10, vatRate: 19 },
    { description: 'Knihy', quantity: 1, unit: 'ks', unitPrice: 20, vatRate: 5 },
  ],
  payments: [{ date: '2026-10-25', documentNumber: 'BV2610', amount: 258.9, method: 'bank' }],
};

describe('vatGroups', () => {
  it('rozdelí sadzby SK 2025 na základnú a znížené', () => {
    const g = vatGroups(invoice.lines, [23, 20]);
    expect(g).toEqual([
      { rate: 23, base: 200, vat: 46, kind: 'base' },
      { rate: 19, base: 10, vat: 1.9, kind: 'reduced' },
      { rate: 5, base: 20, vat: 1, kind: 'reduced' },
    ]);
  });
});

describe('buildMrpXml', () => {
  const xml = buildMrpXml('incoming', [invoice]);

  it('má obálku MRPKSData a agendu IncomingInvoices', () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<MRPKSData>\n  <IncomingInvoices>/);
    expect(xml.trim().endsWith('</MRPKSData>')).toBe(true);
  });

  it('sčíta znížené sadzby do hlavičky a dá rozpis do SumValues', () => {
    expect(xml).toContain('<BaseTaxRateAmount>200.00</BaseTaxRateAmount>');
    expect(xml).toContain('<BaseTaxRateTax>46.00</BaseTaxRateTax>');
    expect(xml).toContain('<ReducedTaxRateAmount>30.00</ReducedTaxRateAmount>');
    expect(xml).toContain('<ReducedTaxRateTax>2.90</ReducedTaxRateTax>');
    expect(xml.match(/<SumValue>/g)).toHaveLength(3);
    expect(xml).toContain('<TaxApplied>46.00</TaxApplied>');
  });

  it('použije SK typ DPH 40 pre prijaté a 10 pre vydané', () => {
    expect(xml).toContain('<TaxCode>40</TaxCode>');
    expect(buildMrpXml('issued', [invoice])).toContain('<TaxCode>10</TaxCode>');
  });

  it('zapíše úhradu bankou', () => {
    expect(xml).toContain('<PaymentType>1</PaymentType>');
    expect(xml).toContain('<Amount>258.90</Amount>');
  });

  it('odmietne dlhé číslo dokladu, cudziu menu a duplicitu', () => {
    expect(() => buildMrpXml('issued', [{ ...invoice, documentNumber: 'X'.repeat(11) }])).toThrow(MrpExportError);
    expect(() => buildMrpXml('issued', [{ ...invoice, currency: 'USD' }])).toThrow(MrpExportError);
    expect(() => buildMrpXml('issued', [invoice, invoice])).toThrow(MrpExportError);
  });
});

describe('toCp1250Safe', () => {
  it('nechá slovenskú diakritiku a nahradí znaky mimo Windows-1250', () => {
    expect(toCp1250Safe('Žltá ľalia ôäň')).toBe('Žltá ľalia ôäň');
    expect(toCp1250Safe('Łódź ā 😀')).toBe('Łódź a ?');
  });
});
