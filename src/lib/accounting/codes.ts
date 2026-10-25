/**
 * Účtovné údaje dokladu (`documents.accounting` jsonb) a číselníky firmy (`company_code_lists`).
 * Jediný zdroj kľúčov a ich mapovania na MRP-K/S. Čisté funkcie (klient aj server).
 */

export const CODE_LISTS = {
  bookkeeping_code: { label: 'Predkontácia', short: 'Predkontácia', hint: 'číslo predkontácie z MRP, napr. 12 alebo 12.5' },
  vat_code: { label: 'Typ DPH', short: 'Typ DPH', hint: 'kód z číselníka MRP, napr. 40 prijaté, 10 vydané' },
  cost_centre: { label: 'Stredisko', short: 'Stredisko', hint: 'max. 6 znakov' },
  project: { label: 'Zákazka', short: 'Zákazka', hint: 'max. 15 znakov' },
  numeric_series: { label: 'Číselný rad (prefix)', short: 'Číselný rad', hint: 'prefix radu v MRP, max. 10 znakov' },
} as const;
export type CodeList = keyof typeof CODE_LISTS;
export const CODE_LIST_KEYS = Object.keys(CODE_LISTS) as CodeList[];
export const isCodeList = (k: unknown): k is CodeList => typeof k === 'string' && k in CODE_LISTS;

/** Hodnoty na doklade: kód z číselníka per zoznam. */
export type Accounting = Partial<Record<CodeList, string>>;

export interface CodeItem {
  id: string;
  list: CodeList;
  code: string;
  name: string | null;
  /** Druhy dokladov, pre ktoré položka platí; null/prázdne = všetky. */
  kinds: string[] | null;
  is_default: boolean;
  active: boolean;
  sort: number;
}

/** Kontrola kódu podľa limitov MRP; vráti chybu alebo null. */
export function validateCode(list: CodeList, code: string): string | null {
  const c = code.trim();
  if (!c) return 'Kód je povinný.';
  switch (list) {
    case 'bookkeeping_code':
      return /^\d{1,12}(\.\d{1,3})?$/.test(c) ? null : 'Predkontácia v MRP je číslo (napr. 12 alebo 12.5).';
    case 'vat_code':
      return /^\d{1,4}$/.test(c) ? null : 'Typ DPH je celé číslo.';
    case 'cost_centre':
      return c.length <= 6 ? null : 'Stredisko má najviac 6 znakov.';
    case 'project':
      return c.length <= 15 ? null : 'Zákazka má najviac 15 znakov.';
    case 'numeric_series':
      return c.length <= 10 ? null : 'Prefix radu má najviac 10 znakov.';
  }
}

/** Z ľubovoľného JSON nechá len známe kľúče s neprázdnou hodnotou. */
export function normalizeAccounting(raw: unknown): Accounting {
  const out: Accounting = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of CODE_LIST_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    else if (typeof v === 'number') out[k] = String(v);
  }
  return out;
}

export const isEmptyAccounting = (a: Accounting) => CODE_LIST_KEYS.every((k) => !a[k]);

const appliesTo = (item: CodeItem, kind: string) => !item.kinds?.length || item.kinds.includes(kind);

/** Položky číselníka použiteľné pre druh dokladu (aktívne), zoradené. */
export function itemsFor(items: CodeItem[], list: CodeList, kind: string): CodeItem[] {
  return items
    .filter((i) => i.list === list && i.active && appliesTo(i, kind))
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code, 'sk'));
}

/** Predvolené hodnoty firmy pre druh dokladu (položky s `is_default`). */
export function defaultsFor(items: CodeItem[], kind: string): Accounting {
  const out: Accounting = {};
  for (const k of CODE_LIST_KEYS) {
    const d = itemsFor(items, k, kind).find((i) => i.is_default);
    if (d) out[k] = d.code;
  }
  return out;
}

/** Hodnoty pre export: predvolené firmy, prepísané hodnotami z dokladu. */
export const effectiveAccounting = (doc: Accounting, items: CodeItem[], kind: string): Accounting => ({
  ...defaultsFor(items, kind),
  ...normalizeAccounting(doc),
});

/** Návrh z histórie: pre každý kľúč najčastejšia hodnota (pri zhode novšia — vstup je od najnovšieho). */
export function suggestFromHistory(history: Accounting[]): Accounting {
  const out: Accounting = {};
  for (const k of CODE_LIST_KEYS) {
    const counts = new Map<string, number>();
    for (const h of history) {
      const v = h[k];
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: string | undefined;
    for (const [v, n] of counts) if (best === undefined || n > counts.get(best)!) best = v;
    if (best) out[k] = best;
  }
  return out;
}

// ── Pravidlá automatického účtovania ─────────────────────────────

export interface RuleMatch {
  partner_ico?: string | null;
  kind?: string | null;
  text_contains?: string | null;
}
export interface Rule {
  id: string;
  name: string | null;
  priority: number;
  active: boolean;
  match: RuleMatch;
  apply: { accounting?: Accounting };
}
export interface RuleContext {
  partner_ico: string | null;
  kind: string;
  /** Partner + položky + poznámka — pre `text_contains`. */
  text: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function ruleMatches(m: RuleMatch, ctx: RuleContext): boolean {
  const conditions = [m.partner_ico, m.kind, m.text_contains].filter((v) => v != null && String(v).trim() !== '');
  if (!conditions.length) return false; // prázdne pravidlo by sedelo na všetko
  if (m.partner_ico && m.partner_ico.replace(/\D/g, '') !== (ctx.partner_ico ?? '').replace(/\D/g, '')) return false;
  if (m.kind && m.kind !== ctx.kind) return false;
  if (m.text_contains && !fold(ctx.text).includes(fold(m.text_contains.trim()))) return false;
  return true;
}

/** Prvé aktívne pravidlo podľa priority (nižšie číslo skôr), ktoré sedí. */
export function findRule(rules: Rule[], ctx: RuleContext): Rule | null {
  return [...rules].filter((r) => r.active).sort((a, b) => a.priority - b.priority).find((r) => ruleMatches(r.match, ctx)) ?? null;
}

// ── CSV import číselníka ─────────────────────────────────────────

/** `kód;názov` (aj `,` alebo tab; hlavička s „kód"/„code" sa preskočí). */
export function parseCodeCsv(list: CodeList, text: string): { rows: { code: string; name: string | null }[]; errors: string[] } {
  const rows: { code: string; name: string | null }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim()) return;
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      const [rawCode, ...rest] = line.split(sep);
      const code = rawCode.trim().replace(/^"|"$/g, '');
      const name = rest.join(sep).trim().replace(/^"|"$/g, '') || null;
      if (i === 0 && /^(k[oó]d|code)$/i.test(code)) return;
      const err = validateCode(list, code);
      if (err) errors.push(`Riadok ${i + 1}: ${err}`);
      else if (seen.has(code)) errors.push(`Riadok ${i + 1}: kód ${code} je v súbore dvakrát.`);
      else {
        seen.add(code);
        rows.push({ code, name });
      }
    });
  return { rows, errors };
}
