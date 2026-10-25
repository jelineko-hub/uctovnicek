import { z } from 'zod';

/**
 * Výstup vyťaženia dokladu (Claude, structured outputs). Názvy polí zodpovedajú
 * stĺpcom `uctovnicek.documents` / `document_lines`, aby sa dali uložiť bez prekladu.
 * Chýbajúci údaj = null, nikdy nie odhad.
 */

const party = z.object({
  name: z.string().nullable(),
  ico: z.string().nullable().describe('IČO, len číslice'),
  dic: z.string().nullable().describe('DIČ, len číslice'),
  ic_dph: z.string().nullable().describe('IČ DPH vrátane predpony krajiny, napr. SK2020123456'),
  street: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  country_code: z.string().nullable().describe('ISO 3166-1 alpha-2, napr. SK'),
  iban: z.string().nullable(),
});

export const extractedLine = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unit_price: z.number().describe('Cena za MJ BEZ DPH, v mene dokladu'),
  vat_rate: z.number().describe('Sadzba DPH v %, napr. 23, 19, 5, 0'),
});

export const extractedDocument = z.object({
  kind: z.enum(['receipt', 'received_invoice', 'issued_invoice', 'cash', 'other']),
  subtype: z.enum(['invoice', 'advance', 'credit', 'debit', 'tax_payment', 'corrective', 'proforma']),
  supplier: party,
  customer: party,
  number: z.string().nullable().describe('Číslo dokladu tak, ako je uvedené na doklade'),
  variable_symbol: z.string().nullable(),
  constant_symbol: z.string().nullable(),
  ekasa_uid: z.string().nullable().describe('Unikátny identifikátor dokladu eKasa (UID), ak je na bločku'),
  issue_date: z.string().nullable().describe('YYYY-MM-DD'),
  tax_point_date: z.string().nullable().describe('Dátum dodania / DUZP, YYYY-MM-DD'),
  due_date: z.string().nullable().describe('YYYY-MM-DD'),
  currency: z.string().describe('ISO 4217, napr. EUR'),
  total_amount: z.number().nullable().describe('Celková suma na úhradu S DPH'),
  payment_method: z.enum(['transfer', 'card', 'cash', 'cash_on_delivery', 'offset', 'other']).nullable(),
  vat_mode: z.enum(['standard', 'reverse_charge', 'exempt', 'oss', 'non_vat']),
  vat_summary: z
    .array(z.object({ rate: z.number(), base: z.number(), vat: z.number() }))
    .describe('Rekapitulácia DPH presne tak, ako je vytlačená na doklade'),
  lines: z.array(extractedLine),
  confidence: z.number().describe('Istota vyťaženia 0–1'),
  notes: z.string().nullable().describe('Čo bolo nečitateľné alebo neisté, po slovensky'),
});

export type ExtractedDocument = z.infer<typeof extractedDocument>;
export type ExtractedLine = z.infer<typeof extractedLine>;
