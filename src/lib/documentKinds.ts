/**
 * Jediný zdroj názvov pre druhy, podtypy a stavy dokladov (hodnoty = DB CHECK constraint
 * v `uctovnicek.documents`). Nová hodnota = aj migrácia CHECK constraintu.
 */

export const KINDS = {
  receipt: 'Bloček',
  received_invoice: 'Prijatá faktúra',
  issued_invoice: 'Vydaná faktúra',
  cash: 'Pokladničný doklad',
  other: 'Iný doklad',
} as const;
export type Kind = keyof typeof KINDS;

/** Názvy agend v menu (množné číslo). */
export const KIND_SECTIONS: Record<Kind, string> = {
  receipt: 'Bločky',
  received_invoice: 'Prijaté faktúry',
  issued_invoice: 'Vydané faktúry',
  cash: 'Pokladňa',
  other: 'Iné doklady',
};

export const SUBTYPES = {
  invoice: 'Bežný doklad',
  advance: 'Zálohová faktúra',
  proforma: 'Predfaktúra',
  credit: 'Dobropis',
  debit: 'Ťarchopis',
  tax_payment: 'Daňový doklad k platbe',
  corrective: 'Opravná faktúra',
} as const;
export type Subtype = keyof typeof SUBTYPES;

export const STATUSES = {
  unprocessed: 'Nespracovaný',
  ready: 'Pripravený',
  approved: 'Schválený',
  rejected: 'Zamietnutý',
  exported: 'Exportovaný',
  archived: 'Archivovaný',
} as const;
export type Status = keyof typeof STATUSES;

export const PAYMENT_METHODS = {
  transfer: 'Prevodom',
  card: 'Kartou',
  cash: 'V hotovosti',
  cash_on_delivery: 'Dobierka',
  offset: 'Zápočet',
  other: 'Iné',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const VAT_MODES = {
  standard: 'Bežný režim',
  reverse_charge: 'Prenesenie daňovej povinnosti',
  exempt: 'Oslobodené od DPH',
  oss: 'OSS (EÚ)',
  non_vat: 'Neplatiteľ DPH',
} as const;
export type VatMode = keyof typeof VAT_MODES;

/** SK sadzby DPH od 1. 1. 2025 + 0 % (oslobodené / neplatiteľ). */
export const VAT_RATES = [23, 19, 5, 0] as const;

export const isKey = <T extends object>(obj: T, k: unknown): k is keyof T =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
