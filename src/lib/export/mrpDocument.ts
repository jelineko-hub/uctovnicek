/**
 * Doklad Účtovníčka → faktúra MRP-K/S (čisté funkcie, bez DB) + kontrola pred exportom.
 * XML skladá `lib/mrp/xml.ts`; tu je len mapovanie, nastavenia firmy a hlášky pre náhľad exportu.
 */
import { buildMrpXml, MrpExportError, type MrpAgenda, type MrpInvoice } from '../mrp/xml';
import { totals } from '../vat';

export type ExportKind = 'received_invoice' | 'issued_invoice';
export const EXPORT_KINDS: Record<ExportKind, { label: string; agenda: MrpAgenda; short: string }> = {
  received_invoice: { label: 'Prijaté faktúry', agenda: 'incoming', short: 'FP' },
  issued_invoice: { label: 'Vydané faktúry', agenda: 'issued', short: 'FV' },
};
export const isExportKind = (k: unknown): k is ExportKind => k === 'received_invoice' || k === 'issued_invoice';

/** Stavy exportu (= CHECK `exports.status`). */
export const EXPORT_STATUSES = {
  created: 'Vytvorený',
  downloaded: 'Stiahnutý',
  imported: 'Naimportovaný',
  failed: 'Chyba importu',
  cancelled: 'Zrušený',
} as const;
export type ExportStatus = keyof typeof EXPORT_STATUSES;

/** Nastavenie exportu do MRP vo firme (`companies.settings.mrp`). */
export interface MrpSettings {
  /** Prefix číselného radu v MRP — doklad očísluje MRP pri importe. */
  prefix_received?: string | null;
  prefix_issued?: string | null;
  /** Kód „Typ DPH" z číselníka MRP (predvolené 40 prijaté / 10 vydané podľa dokumentácie). */
  tax_code_received?: number | null;
  tax_code_issued?: number | null;
}

export interface ExportLine {
  name: string;
  quantity: number | string;
  unit: string | null;
  unit_price: number | string;
  vat_rate: number | string;
  discount_percent?: number | string | null;
}

export interface ExportDocument {
  id: string;
  kind: string;
  subtype: string;
  number: string | null;
  original_number: string | null;
  variable_symbol: string | null;
  constant_symbol: string | null;
  issue_date: string | null;
  tax_point_date: string | null;
  delivery_date: string | null;
  due_date: string | null;
  currency: string;
  total_amount: number | string | null;
  vat_mode: string;
  note: string | null;
  partner_snapshot: {
    name?: string | null;
    ico?: string | null;
    dic?: string | null;
    ic_dph?: string | null;
    street?: string | null;
    city?: string | null;
    zip?: string | null;
    country_code?: string | null;
  } | null;
  lines: ExportLine[];
}

const prefixFor = (kind: ExportKind, s: MrpSettings) =>
  (kind === 'received_invoice' ? s.prefix_received : s.prefix_issued)?.trim() || null;

export function mrpOptions(s: MrpSettings) {
  return {
    ...(s.tax_code_received ? { taxCodeIncoming: Number(s.tax_code_received) } : {}),
    ...(s.tax_code_issued ? { taxCodeIssued: Number(s.tax_code_issued) } : {}),
  };
}

export function toMrpInvoice(doc: ExportDocument, kind: ExportKind, s: MrpSettings, vatPayer: boolean): MrpInvoice {
  const p = doc.partner_snapshot ?? {};
  return {
    documentNumber: doc.number?.trim() || null,
    documentNumberPrefix: doc.number?.trim() ? null : prefixFor(kind, s),
    uuid: doc.id,
    originalNumber: doc.original_number,
    docType: doc.subtype === 'credit' ? 'credit' : doc.subtype === 'debit' ? 'debit' : 'invoice',
    invoiceType: doc.subtype === 'proforma' ? 'proforma' : 'regular',
    issueDate: doc.issue_date ?? '',
    taxPointDate: doc.tax_point_date,
    deliveryDate: doc.delivery_date,
    dueDate: doc.due_date,
    currency: doc.currency,
    variableSymbol: doc.variable_symbol,
    constantSymbol: doc.constant_symbol,
    note: doc.note,
    vatDeductible: vatPayer,
    partner: {
      name: p.name ?? '',
      ico: p.ico,
      dic: p.dic,
      icDph: p.ic_dph,
      street: p.street,
      city: p.city,
      zip: p.zip,
      countryCode: p.country_code,
    },
    lines: doc.lines.map((l) => ({
      description: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPrice: Number(l.unit_price),
      vatRate: Number(l.vat_rate),
      discountPercent: Number(l.discount_percent ?? 0),
    })),
  };
}

export interface DocumentCheck {
  errors: string[];
  warnings: string[];
}

/** Kontrola jedného dokladu pred exportom: chyby export zastavia, upozornenia nie. */
export function checkDocument(doc: ExportDocument, kind: ExportKind, s: MrpSettings, vatPayer: boolean): DocumentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (doc.kind !== kind) errors.push('Iný druh dokladu, než sa exportuje.');
  if (!doc.issue_date) errors.push('Chýba dátum vystavenia.');
  if (!doc.partner_snapshot?.name) errors.push('Chýba partner.');
  if (!doc.lines.length) errors.push('Doklad nemá položky (MRP ich vyžaduje).');
  if (!doc.number?.trim() && !prefixFor(kind, s)) {
    errors.push('Chýba prefix číselného radu MRP v nastavení exportu.');
  }
  if (!errors.length) {
    try {
      buildMrpXml(EXPORT_KINDS[kind].agenda, [toMrpInvoice(doc, kind, s, vatPayer)], mrpOptions(s));
    } catch (e) {
      if (!(e instanceof MrpExportError)) throw e;
      errors.push(e.message);
    }
  }

  if (doc.total_amount != null && doc.total_amount !== '' && doc.lines.length) {
    const computed = totals(
      doc.lines.map((l) => ({
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        vatRate: Number(l.vat_rate),
        discountPercent: Number(l.discount_percent ?? 0),
      })),
    ).total;
    if (Math.abs(computed - Number(doc.total_amount)) > 0.02) {
      warnings.push(`Súčet položiek ${computed.toFixed(2)} nesedí so sumou dokladu ${Number(doc.total_amount).toFixed(2)}.`);
    }
  }
  if (!doc.partner_snapshot?.ico) warnings.push('Partner nemá IČO.');
  if (doc.subtype === 'credit' || doc.subtype === 'debit') {
    warnings.push('Dobropis/ťarchopis: znamienka súm over pri prvom importe do MRP.');
  }
  if (doc.subtype === 'advance' || doc.subtype === 'tax_payment' || doc.subtype === 'corrective') {
    warnings.push('Tento typ faktúry sa exportuje ako bežná faktúra.');
  }
  if (doc.vat_mode !== 'standard') warnings.push('Iný režim DPH než bežný — skontroluj „Typ DPH" v MRP.');
  return { errors, warnings };
}

/** 'YYYY-MM' → prvý a posledný deň mesiaca, alebo null pri neplatnom vstupe. */
export function periodRange(period: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/** Predchádzajúci mesiac ako 'YYYY-MM' (predvolené obdobie exportu). */
export function previousPeriod(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Dátum, podľa ktorého doklad patrí do obdobia: DUZP, inak dátum vystavenia. */
export const periodDate = (d: { tax_point_date: string | null; issue_date: string | null }) =>
  d.tax_point_date ?? d.issue_date;

export function exportFileName(kind: ExportKind, period: string, exportId: string) {
  return `MRP_${EXPORT_KINDS[kind].short}_${period}_${exportId.slice(0, 8)}.xml`;
}
