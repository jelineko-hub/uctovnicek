/**
 * Bloček z eKasa → stĺpce `documents` + `document_lines` (čistá funkcia, testovaná na reálnom bločku).
 * eKasa dáva cenu riadku S DPH; ukladáme jednotkovú cenu BEZ DPH (pravidlo projektu).
 */
import type { DocumentPatch, LineRow, PartnerSnapshot } from '../extraction/toDocument';
import { round2, totals } from '../vat';
import type { EkasaAddress, EkasaReceipt } from './types';

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '') || null;
const hasDigit = (s: string | null | undefined) => !!s && /\d/.test(s);

/** 'dd.MM.yyyy HH:mm:ss' → 'yyyy-MM-dd' */
export function ekasaDate(s: string | null | undefined): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function street(a: EkasaAddress): string | null {
  const no = [a.propertyRegistrationNumber, a.buildingNumber].filter(hasDigit).join('/');
  return [a.streetName?.trim(), no].filter(Boolean).join(' ') || null;
}

function partner(r: EkasaReceipt): PartnerSnapshot {
  const o = r.organization ?? {};
  return {
    name: o.name?.trim() || null,
    ico: digits(o.ico ?? r.ico),
    dic: digits(o.dic ?? r.dic),
    ic_dph: (o.icDph ?? r.icDph)?.replace(/\s+/g, '').toUpperCase() || null,
    street: street(o),
    city: o.municipality?.trim() || null,
    zip: o.postalCode?.replace(/\s+/g, '') || null,
    country_code: !o.country || /^sloven/i.test(o.country) ? 'SK' : null,
    iban: null,
  };
}

export interface EkasaDocument {
  patch: Omit<DocumentPatch, 'ocr_confidence'> & { ocr_confidence: number };
  lines: LineRow[];
  /** Rekapitulácia DPH z eKasa (pre kontrolu v editore, rovnaký tvar ako pri vyťažení). */
  vatSummary: { rate: number; base: number; vat: number }[];
  warnings: string[];
}

export function ekasaToDocument(r: EkasaReceipt): EkasaDocument {
  const warnings: string[] = [];
  if (r.type !== 'PD') warnings.push(`Typ dokladu v eKasa je „${r.type}" (nie bežný pokladničný doklad) — skontroluj.`);
  if (r.paragon) warnings.push('Doklad bol vystavený ako paragón (pokladnica bola offline).');

  const lines: LineRow[] = r.items
    .filter((i) => i.name?.trim())
    .map((i, position) => {
      const quantity = i.quantity || 1;
      const rate = i.vatRate ?? 0;
      return {
        position,
        name: i.name.trim(),
        quantity,
        unit: null,
        unit_price: Math.round((i.price / quantity / (1 + rate / 100)) * 1e6) / 1e6,
        vat_rate: rate,
      };
    });

  const vatSummary = (r.vatSummary ?? []).map((v) => ({ rate: v.vat.vatRate, base: v.vatBase, vat: v.vatAmount }));
  const computed = totals(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price, vatRate: l.vat_rate })),
    { pricesWithVat: true },
  );
  if (Math.abs(computed.total - r.totalPrice) > 0.011) {
    warnings.push(`Súčet položiek ${computed.total.toFixed(2)} € nesedí so sumou bločku ${r.totalPrice.toFixed(2)} €.`);
  }

  const date = ekasaDate(r.issueDate);
  const vatPayer = r.organization?.vatPayer;
  return {
    patch: {
      kind: 'receipt',
      subtype: 'invoice',
      partner_snapshot: partner(r),
      original_number: r.receiptNumber != null ? String(r.receiptNumber) : r.paragonNumber != null ? String(r.paragonNumber) : null,
      variable_symbol: null,
      constant_symbol: null,
      ekasa_uid: r.receiptId,
      issue_date: date,
      tax_point_date: date,
      due_date: null,
      currency: 'EUR',
      total_amount: round2(r.totalPrice),
      payment_method: 'cash',
      vat_mode: vatPayer === false ? 'non_vat' : r.exemption ? 'exempt' : 'standard',
      prices_with_vat: true,
      ocr_confidence: 1,
    },
    lines,
    vatSummary,
    warnings,
  };
}
