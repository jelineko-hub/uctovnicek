/**
 * Export faktúr do MRP-K/S — formát XML verzia 2.0.
 *
 * Zdroj formátu: oficiálna dokumentácia MRP (docs/mrp/mrpks_xml_2_0_doc_fv.txt,
 * docs/mrp/mrpks_xml_2_0_doc_fp.txt, MRP-K/S 6.75(001), 24.02.2025) a vzorové
 * súbory v docs/mrp/. Import v MRP-K/S: Export/Import → Import (zo súboru XML 2.0),
 * pred prvým importom treba v MRP založiť importný profil (číselný rad, typ DPH).
 *
 * Rozsah MVP:
 *  - vydané (IssuedInvoices) aj prijaté (IncomingInvoices) faktúry v EUR,
 *  - ľubovoľný počet sadzieb DPH (SK 2025: 23 % základná, 19 % a 5 % znížené),
 *    preto vždy posielame aj rozpis SumValues,
 *  - úhrady (Payments), partner (Company), položky (Items).
 * Cudzia mena zatiaľ nie je podporovaná (význam CurrRate/CurrRateAmount v SK verzii
 * treba overiť na reálnom importe) — export takého dokladu vyhodí chybu.
 */

export type MrpAgenda = 'issued' | 'incoming';

export interface MrpPartner {
  ico?: string | null;
  dic?: string | null;      // SK verzia: <VatNumber> = DIČ
  icDph?: string | null;    // SK verzia: <VatNumberSK> = IČ DPH
  name: string;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  countryCode?: string | null; // 'SK', 'CZ', …
  email?: string | null;
  naturalPerson?: boolean;
}

export interface MrpLine {
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;        // bez DPH, v mene dokladu
  vatRate: number;          // %, 0 = oslobodené
  discountPercent?: number;
  costCentre?: string | null;
  contractNumber?: string | null;
}

export interface MrpPayment {
  date: string;             // YYYY-MM-DD
  documentNumber: string;   // číslo bankového výpisu / pokladničného dokladu
  amount: number;
  method: 'bank' | 'cash';
}

export interface MrpInvoice {
  documentNumber: string;   // max 10 znakov, jedinečné v MRP
  originalNumber?: string | null;  // číslo dodávateľa (prijaté faktúry)
  docType?: 'invoice' | 'credit' | 'debit';
  creditNoteOriginalNumber?: string | null;
  invoiceType?: 'regular' | 'proforma';
  issueDate: string;
  taxPointDate?: string | null;
  deliveryDate?: string | null;
  dueDate?: string | null;
  currency?: string;        // len 'EUR' v MVP
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  paymentMeans?: string | null;    // text formy úhrady podľa číselníka MRP, napr. 'prevodom'
  note?: string | null;
  bookkeepingCode?: string | null; // číslo predkontácie (podvojné účtovníctvo)
  costCentre?: string | null;
  contractNumber?: string | null;
  vatDeductible?: boolean;  // prijaté: nárok na odpočet (default true)
  partner: MrpPartner;
  lines: MrpLine[];
  payments?: MrpPayment[];
}

export interface MrpOptions {
  /** Kód „Typ DPH" z číselníka MRP. Dokumentácia: SK verzia 10 = tuzemské uskutočnené, 40 = tuzemské prijaté. */
  taxCodeIssued?: number;
  taxCodeIncoming?: number;
  /** Ktoré sadzby sú v SK základné (ostatné nenulové = znížené). */
  baseRates?: number[];
}

const DEFAULTS: Required<MrpOptions> = {
  taxCodeIssued: 10,
  taxCodeIncoming: 40,
  baseRates: [23, 20],
};

export class MrpExportError extends Error {}

// ── formátovanie ────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (n: number, places: number) => n.toFixed(places);
const bool = (b: boolean) => (b ? 'T' : 'F');

let cp1250: Set<string> | null = null;
/** MRP databáza je vo Windows-1250 — znaky mimo tejto kódovej stránky nahradíme. */
export function toCp1250Safe(s: string): string {
  if (!cp1250) {
    const dec1250 = new TextDecoder('windows-1250');
    cp1250 = new Set(dec1250.decode(Uint8Array.from({ length: 256 }, (_, i) => i)));
  }
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (cp1250.has(ch)) out += ch;
    else {
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
      out += [...base].every((c) => cp1250!.has(c)) ? base : '?';
    }
  }
  return out;
}

function esc(s: string): string {
  return toCp1250Safe(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function el(name: string, value: string | number | null | undefined, indent: string): string {
  if (value === null || value === undefined || value === '') return '';
  return `${indent}<${name}>${typeof value === 'number' ? String(value) : esc(value)}</${name}>\n`;
}

function clip(name: string, value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  if (value.length > max) throw new MrpExportError(`${name} „${value}" je dlhšie ako ${max} znakov (limit MRP).`);
  return value;
}

// ── výpočet ─────────────────────────────────────────────────────

export interface VatGroup {
  rate: number;
  base: number;
  vat: number;
  kind: 'base' | 'reduced' | 'zero';
}

export function vatGroups(lines: MrpLine[], baseRates: number[]): VatGroup[] {
  const by = new Map<number, number>();
  for (const l of lines) {
    const net = (l.unitPrice * (1 - (l.discountPercent ?? 0) / 100)) * l.quantity;
    by.set(l.vatRate, (by.get(l.vatRate) ?? 0) + net);
  }
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => {
      const b = round2(base);
      return {
        rate,
        base: b,
        vat: round2((b * rate) / 100),
        kind: rate === 0 ? 'zero' : baseRates.includes(rate) ? 'base' : 'reduced',
      };
    });
}

// ── XML ─────────────────────────────────────────────────────────

function invoiceXml(inv: MrpInvoice, agenda: MrpAgenda, o: Required<MrpOptions>): string {
  if ((inv.currency ?? 'EUR') !== 'EUR') {
    throw new MrpExportError(`Doklad ${inv.documentNumber}: export v mene ${inv.currency} zatiaľ nie je podporovaný.`);
  }
  if (!inv.lines.length) throw new MrpExportError(`Doklad ${inv.documentNumber} nemá položky.`);

  const taxCode = agenda === 'issued' ? o.taxCodeIssued : o.taxCodeIncoming;
  const groups = vatGroups(inv.lines, o.baseRates);
  const sum = (k: VatGroup['kind'], f: 'base' | 'vat') =>
    round2(groups.filter((g) => g.kind === k).reduce((a, g) => a + g[f], 0));
  const total = round2(groups.reduce((a, g) => a + g.base + g.vat, 0));
  const paid = round2((inv.payments ?? []).reduce((a, p) => a + p.amount, 0));
  const deductible = agenda === 'incoming' && inv.vatDeductible !== false;
  const docType = inv.docType === 'credit' ? 'D' : inv.docType === 'debit' ? 'V' : ' ';
  const i = '      ';
  const ii = '        ';
  const iii = '          ';

  let x = '    <Invoice>\n';
  x += el('DocumentNumber', clip('Číslo dokladu', inv.documentNumber, 10), i);
  x += el('IssueDate', inv.issueDate, i);
  x += el('CurrencyCode', 'EUR', i);
  x += el('ValuesWithTax', 'F', i);
  x += el('TaxCode', taxCode, i);
  x += `${i}<DocType>${docType}</DocType>\n`;
  x += el('ZeroTaxRateAmount', dec(sum('zero', 'base'), 2), i);
  x += el('ReducedTaxRateAmount', dec(sum('reduced', 'base'), 2), i);
  x += el('BaseTaxRateAmount', dec(sum('base', 'base'), 2), i);
  x += el('RoundingAmount', dec(0, 2), i);
  x += el('ReducedTaxRateTax', dec(sum('reduced', 'vat'), 2), i);
  x += el('BaseTaxRateTax', dec(sum('base', 'vat'), 2), i);
  x += el('TaxPointDate', inv.taxPointDate ?? inv.issueDate, i);
  x += el('DeliveryDate', inv.deliveryDate ?? inv.taxPointDate ?? inv.issueDate, i);
  if (inv.bookkeepingCode) x += el('DoubleEntryBookkeepingCode', inv.bookkeepingCode, i);
  x += el('OriginalDocumentNumber', clip('Pôvodné číslo', inv.originalNumber, 50), i);
  x += el('CreditNoteOriginalNumber', clip('Číslo opravovanej faktúry', inv.creditNoteOriginalNumber, 50), i);
  x += el('CostCentre', clip('Stredisko', inv.costCentre, 6), i);
  x += el('ContractNumber', clip('Zákazka', inv.contractNumber, 15), i);
  x += el('VatRegime', 0, i);
  x += el('VatCountry', 'SK', i);
  x += el('VariableSymbol', clip('VS', inv.variableSymbol, 10), i);
  x += el('ConstantSymbol', clip('KS', inv.constantSymbol, 8), i);
  x += el('SpecificSymbol', clip('ŠS', inv.specificSymbol, 10), i);
  x += el('PaymentDueDate', inv.dueDate, i);
  x += el('CurrRateAmount', dec(1, 6), i);
  x += el('CurrRate', dec(1, 6), i);
  x += el('InvoiceType', inv.invoiceType === 'proforma' ? 'X' : 'F', i);
  x += el('PaymentMeansCode', clip('Forma úhrady', inv.paymentMeans, 10), i);
  x += el('Note', inv.note, i);

  const p = inv.partner;
  x += `${i}<Company>\n`;
  x += el('CompanyId', clip('IČO', p.ico, 12), ii);
  x += el('Name', clip('Názov partnera', p.name, 50), ii);
  x += el('Street', clip('Ulica', p.street, 30), ii);
  x += el('City', clip('Mesto', p.city, 30), ii);
  x += el('CountryCode', p.countryCode ?? 'SK', ii);
  x += el('ZipCode', clip('PSČ', p.zip, 15), ii);
  x += el('VatNumber', clip('DIČ', p.dic, 17), ii);
  x += el('VatNumberSK', clip('IČ DPH', p.icDph, 14), ii);
  x += el('Email', p.email, ii);
  x += el('NaturalPerson', bool(!!p.naturalPerson), ii);
  x += `${i}</Company>\n`;

  x += `${i}<Items>\n`;
  for (const l of inv.lines) {
    const unitDiscount = (l.unitPrice * (l.discountPercent ?? 0)) / 100;
    x += `${ii}<Item>\n`;
    x += el('Description', clip('Text položky', l.description, 100), iii);
    x += el('RowType', 1, iii);
    x += el('TaxCode', taxCode, iii);
    x += el('UnitCode', clip('Merná jednotka', l.unit, 3), iii);
    x += el('Quantity', dec(l.quantity, 6), iii);
    x += el('UnitPrice', dec(l.unitPrice, 6), iii);
    x += el('TaxPercent', dec(l.vatRate, 2), iii);
    x += el('TaxAmount', dec(((l.unitPrice - unitDiscount) * l.vatRate) / 100, 6), iii);
    x += el('DiscountPercent', dec(l.discountPercent ?? 0, 2), iii);
    x += el('UnitDiscount', dec(unitDiscount, 6), iii);
    x += el('CostCentre', clip('Stredisko', l.costCentre ?? inv.costCentre, 6), iii);
    x += el('ContractNumber', clip('Zákazka', l.contractNumber ?? inv.contractNumber, 15), iii);
    x += el('RowSumType', 1, iii);
    x += `${ii}</Item>\n`;
  }
  x += `${i}</Items>\n`;

  x += `${i}<SumValues>\n`;
  for (const g of groups) {
    x += `${ii}<SumValue>\n`;
    x += el('TaxCode', taxCode, iii);
    x += el('TaxType', g.kind === 'base' ? 1 : g.kind === 'reduced' ? 2 : 3, iii);
    x += el('TaxPercent', dec(g.rate, 2), iii);
    x += el('CurrencyCode', 'EUR', iii);
    x += el('Amount', dec(g.base, 2), iii);
    x += el('Tax', dec(g.vat, 2), iii);
    if (agenda === 'incoming') x += el('TaxApplied', dec(deductible ? g.vat : 0, 2), iii);
    x += `${ii}</SumValue>\n`;
  }
  x += `${i}</SumValues>\n`;

  if (inv.payments?.length) {
    if (paid - total > 0.005) {
      throw new MrpExportError(`Doklad ${inv.documentNumber}: úhrady ${paid} prevyšujú sumu dokladu ${total}.`);
    }
    x += `${i}<Payments>\n`;
    for (const pay of inv.payments) {
      x += `${ii}<Payment>\n`;
      x += el('PaymentType', pay.method === 'bank' ? 1 : 2, iii);
      x += el('PaymentDate', pay.date, iii);
      x += el('DocumentNumber', clip('Číslo dokladu úhrady', pay.documentNumber, 10), iii);
      x += el('Amount', dec(pay.amount, 2), iii);
      x += el('AmountCurr', dec(pay.amount, 2), iii);
      x += el('AmountPaidDocumentCurr', dec(pay.amount, 2), iii);
      x += el('CurrencyCode', 'EUR', iii);
      x += el('CurrRate', dec(1, 6), iii);
      x += el('CurrRateAmount', dec(1, 6), iii);
      x += `${ii}</Payment>\n`;
    }
    x += `${i}</Payments>\n`;
  }

  x += '    </Invoice>\n';
  return x;
}

/** Vytvorí kompletný XML súbor MRP-K/S 2.0 pre jednu agendu (vydané alebo prijaté — nemiešať). */
export function buildMrpXml(agenda: MrpAgenda, invoices: MrpInvoice[], options: MrpOptions = {}): string {
  const o = { ...DEFAULTS, ...options };
  const seen = new Set<string>();
  for (const inv of invoices) {
    if (seen.has(inv.documentNumber)) throw new MrpExportError(`Duplicitné číslo dokladu ${inv.documentNumber}.`);
    seen.add(inv.documentNumber);
  }
  const root = agenda === 'issued' ? 'IssuedInvoices' : 'IncomingInvoices';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<MRPKSData>\n' +
    `  <${root}>\n` +
    invoices.map((inv) => invoiceXml(inv, agenda, o)).join('') +
    `  </${root}>\n` +
    '</MRPKSData>\n'
  );
}
