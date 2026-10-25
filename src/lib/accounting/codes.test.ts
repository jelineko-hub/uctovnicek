import { describe, expect, it } from 'vitest';
import {
  defaultsFor,
  effectiveAccounting,
  findRule,
  normalizeAccounting,
  parseCodeCsv,
  ruleMatches,
  suggestFromHistory,
  validateCode,
  type CodeItem,
  type Rule,
} from './codes';

const item = (p: Partial<CodeItem>): CodeItem => ({
  id: Math.random().toString(36),
  list: 'bookkeeping_code',
  code: '1',
  name: null,
  kinds: null,
  is_default: false,
  active: true,
  sort: 0,
  ...p,
});

describe('číselníky a účtovné údaje', () => {
  it('kontrola kódov podľa MRP', () => {
    expect(validateCode('bookkeeping_code', '12.5')).toBeNull();
    expect(validateCode('bookkeeping_code', '501.001.1')).toMatch(/číslo/);
    expect(validateCode('vat_code', '40')).toBeNull();
    expect(validateCode('cost_centre', 'DIELNA1')).toMatch(/6/);
    expect(validateCode('numeric_series', 'FP')).toBeNull();
  });

  it('predvolené hodnoty podľa druhu a prednosť hodnôt z dokladu', () => {
    const items = [
      item({ list: 'numeric_series', code: 'FP', kinds: ['received_invoice'], is_default: true }),
      item({ list: 'numeric_series', code: 'FV', kinds: ['issued_invoice'], is_default: true }),
      item({ list: 'vat_code', code: '40', kinds: ['received_invoice'], is_default: true }),
      item({ list: 'bookkeeping_code', code: '3', is_default: true, active: false }),
    ];
    expect(defaultsFor(items, 'received_invoice')).toEqual({ numeric_series: 'FP', vat_code: '40' });
    expect(defaultsFor(items, 'issued_invoice')).toEqual({ numeric_series: 'FV' });
    expect(effectiveAccounting({ vat_code: '41' }, items, 'received_invoice')).toEqual({ numeric_series: 'FP', vat_code: '41' });
  });

  it('normalizuje jsonb z dokladu', () => {
    expect(normalizeAccounting({ bookkeeping_code: ' 12 ', cost_centre: '', foo: 'x', vat_code: 40 })).toEqual({
      bookkeeping_code: '12',
      vat_code: '40',
    });
    expect(normalizeAccounting(null)).toEqual({});
  });

  it('návrh z histórie = najčastejšia hodnota, pri zhode novšia', () => {
    expect(
      suggestFromHistory([
        { bookkeeping_code: '5', cost_centre: 'A' },
        { bookkeeping_code: '7', cost_centre: 'B' },
        { bookkeeping_code: '7' },
        { bookkeeping_code: '5' },
        { bookkeeping_code: '7' },
      ]),
    ).toEqual({ bookkeeping_code: '7', cost_centre: 'A' });
    expect(suggestFromHistory([])).toEqual({});
  });
});

describe('pravidlá automatického účtovania', () => {
  const ctx = { partner_ico: '31425933', kind: 'receipt', text: 'STAVEBNINY ASAS Obrubník' };
  const rule = (p: Partial<Rule>): Rule => ({
    id: 'r', name: null, priority: 100, active: true, match: {}, apply: { accounting: { bookkeeping_code: '1' } }, ...p,
  });

  it('IČO, druh a text (bez diakritiky)', () => {
    expect(ruleMatches({ partner_ico: '31 425 933' }, ctx)).toBe(true);
    expect(ruleMatches({ partner_ico: '31425933', kind: 'received_invoice' }, ctx)).toBe(false);
    expect(ruleMatches({ text_contains: 'obrubnik' }, ctx)).toBe(true);
    expect(ruleMatches({}, ctx)).toBe(false);
  });

  it('vyhrá aktívne pravidlo s najnižšou prioritou', () => {
    const rules = [
      rule({ id: 'a', priority: 50, match: { kind: 'receipt' } }),
      rule({ id: 'b', priority: 10, match: { partner_ico: '31425933' } }),
      rule({ id: 'c', priority: 1, active: false, match: { kind: 'receipt' } }),
    ];
    expect(findRule(rules, ctx)?.id).toBe('b');
    expect(findRule(rules, { ...ctx, partner_ico: null, kind: 'other' })).toBeNull();
  });
});

describe('CSV import', () => {
  it('hlavička, oddeľovače, chyby a duplicity', () => {
    const { rows, errors } = parseCodeCsv('bookkeeping_code', '﻿kód;názov\n12;Materiál\n13,Služby\n12;znova\nabc;zlé\n\n');
    expect(rows).toEqual([{ code: '12', name: 'Materiál' }, { code: '13', name: 'Služby' }]);
    expect(errors).toHaveLength(2);
  });
});
