import { describe, expect, it } from 'vitest';
import fixture from '../../../test-fixtures/ekasa/receipt-pd.json';
import { totals, vatSummary } from '../vat';
import { ekasaDate, ekasaToDocument } from './toDocument';
import type { EkasaResponse } from './types';
import { normalizeEkasaUid, uidFromQr } from './uid';

const receipt = (fixture as EkasaResponse).receipt!;

describe('eKasa UID', () => {
  it('normalizuje UID z OCR a ručného zadania', () => {
    expect(normalizeEkasaUid('UID:O-9B1B3545701B46F39B3545701BE6F3A6')).toBe('O-9B1B3545701B46F39B3545701BE6F3A6');
    expect(normalizeEkasaUid('o-9b1b 3545 701b 46f3 9b35 4570 1be6 f3a6')).toBe('O-9B1B3545701B46F39B3545701BE6F3A6');
    expect(normalizeEkasaUid('0-9B1B3545701B46F39B354570IBE6F3A6')).toBe('O-9B1B3545701B46F39B3545701BE6F3A6');
    expect(normalizeEkasaUid('O-123')).toBeNull();
    expect(normalizeEkasaUid(null)).toBeNull();
  });

  it('vytiahne UID z obsahu QR', () => {
    expect(uidFromQr('O-9B1B3545701B46F39B3545701BE6F3A6')).toBe('O-9B1B3545701B46F39B3545701BE6F3A6');
    expect(uidFromQr('https://x/?id=o-9b1b3545701b46f39b3545701be6f3a6')).toBe('O-9B1B3545701B46F39B3545701BE6F3A6');
    expect(uidFromQr('88820204195000006:260905083229:217:12.75')).toBeNull();
  });
});

describe('ekasaToDocument (reálny bloček PD)', () => {
  const { patch, lines, vatSummary: printed, warnings } = ekasaToDocument(receipt);

  it('hlavička a partner z eKasa', () => {
    expect(patch).toMatchObject({
      kind: 'receipt',
      original_number: '217',
      issue_date: '2026-09-05',
      tax_point_date: '2026-09-05',
      total_amount: 12.75,
      payment_method: 'cash',
      vat_mode: 'standard',
      ekasa_uid: 'O-9B1B3545701B46F39B3545701BE6F3A6',
      ocr_confidence: 1,
      prices_with_vat: true,
    });
    expect(patch.partner_snapshot).toEqual({
      name: 'STAVEBNINY ASAS spol. s r.o.',
      ico: '31425933',
      dic: '2020419500',
      ic_dph: 'SK2020419500',
      street: 'Pod kalváriou',
      city: 'Topoľčany',
      zip: '95501',
      country_code: 'SK',
      iban: null,
    });
    expect(warnings).toEqual([]);
  });

  it('položky: cena riadku s DPH → jednotková cena bez DPH; DPH sedí s rekapituláciou bločku', () => {
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ name: 'CITYSTONE Obrubník 100x25x5 45ks|pal', quantity: 3, vat_rate: 23 });
    expect(lines[1].unit_price).toBeCloseTo(3.4 / 1.23, 6);
    const lineInput = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price, vatRate: l.vat_rate }));
    expect(vatSummary(lineInput, { pricesWithVat: true })).toEqual(printed);
    expect(printed).toEqual([{ rate: 23, base: 10.37, vat: 2.38 }]);
    expect(totals(lineInput, { pricesWithVat: true }).total).toBe(12.75);
  });

  it('dátum eKasa', () => {
    expect(ekasaDate('05.09.2026 08:32:29')).toBe('2026-09-05');
    expect(ekasaDate('2026-09-05')).toBeNull();
  });
});
