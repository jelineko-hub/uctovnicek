import { normalizeIban } from '../iban';
import { round2 } from '../vat';
import type { ExtractedDocument } from './schema';

/**
 * Prevod výstupu vyťaženia na stĺpce `documents` + riadky `document_lines`.
 * Čistá funkcia — žiadne volania DB, aby sa dala testovať.
 */

const digits = (s: string | null) => {
  const d = (s || '').replace(/\D/g, '');
  return d || null;
};

const isoDate = (s: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

const clean = (s: string | null) => (s && s.trim() ? s.trim() : null);

export interface PartnerSnapshot {
  name: string | null;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country_code: string | null;
  iban: string | null;
}

export interface DocumentPatch {
  kind: ExtractedDocument['kind'];
  subtype: ExtractedDocument['subtype'];
  partner_snapshot: PartnerSnapshot;
  original_number: string | null;
  variable_symbol: string | null;
  constant_symbol: string | null;
  ekasa_uid: string | null;
  issue_date: string | null;
  tax_point_date: string | null;
  due_date: string | null;
  currency: string;
  total_amount: number | null;
  payment_method: ExtractedDocument['payment_method'];
  vat_mode: ExtractedDocument['vat_mode'];
  /** Bločky sa počítajú zo súm s DPH (lib/vat.ts `pricesWithVat`). */
  prices_with_vat: boolean;
  ocr_confidence: number;
}

export interface LineRow {
  position: number;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  vat_rate: number;
}

function party(p: ExtractedDocument['supplier']): PartnerSnapshot {
  return {
    name: clean(p.name),
    ico: digits(p.ico),
    dic: digits(p.dic),
    ic_dph: p.ic_dph ? p.ic_dph.replace(/\s+/g, '').toUpperCase() : null,
    street: clean(p.street),
    city: clean(p.city),
    zip: p.zip ? p.zip.replace(/\s+/g, '') : null,
    country_code: p.country_code ? p.country_code.trim().toUpperCase().slice(0, 2) : null,
    iban: p.iban ? normalizeIban(p.iban) : null,
  };
}

/**
 * @param companyIbans IBAN-y firmy (firma + bankové účty) — ďalší signál pre prijatú vs. vydanú faktúru.
 */
export function toDocument(x: ExtractedDocument, companyIco: string | null, companyIbans: (string | null)[] = []) {
  const own = digits(companyIco);
  const ownIbans = new Set(companyIbans.filter((i): i is string => !!i).map(normalizeIban));
  const supplier = party(x.supplier);
  const customer = party(x.customer);

  // IČO firmy je spoľahlivejšie než úsudok modelu: ak sedí na dodávateľa, je to vydaná faktúra.
  // Bez zhody IČO rozhodne IBAN: na faktúre je účet príjemcu platby, teda dodávateľa.
  let kind = x.kind;
  if (kind !== 'receipt' && kind !== 'cash') {
    if (own && supplier.ico === own) kind = 'issued_invoice';
    else if (own && customer.ico === own) kind = 'received_invoice';
    else if (supplier.iban && ownIbans.has(supplier.iban)) kind = 'issued_invoice';
  }
  const partner = kind === 'issued_invoice' ? customer : supplier;

  const patch: DocumentPatch = {
    kind,
    subtype: x.subtype,
    partner_snapshot: partner,
    original_number: clean(x.number),
    variable_symbol: digits(x.variable_symbol),
    constant_symbol: digits(x.constant_symbol),
    ekasa_uid: clean(x.ekasa_uid),
    issue_date: isoDate(x.issue_date),
    tax_point_date: isoDate(x.tax_point_date),
    due_date: isoDate(x.due_date),
    currency: (x.currency || 'EUR').trim().toUpperCase().slice(0, 3),
    total_amount: x.total_amount == null ? null : round2(x.total_amount),
    payment_method: x.payment_method,
    vat_mode: x.vat_mode,
    prices_with_vat: kind === 'receipt',
    ocr_confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
  };

  const lines: LineRow[] = x.lines
    .filter((l) => l.name.trim())
    .map((l, i) => ({
      position: i,
      name: l.name.trim(),
      quantity: Number.isFinite(l.quantity) && l.quantity !== 0 ? l.quantity : 1,
      unit: clean(l.unit),
      unit_price: Math.round(l.unit_price * 1e6) / 1e6,
      vat_rate: l.vat_rate,
    }));

  return { patch, lines };
}
