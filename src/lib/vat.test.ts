import { describe, expect, it } from 'vitest';
import { netFromGross, totals, vatSummary } from './vat';

describe('vat', () => {
  it('zaokrúhľuje DPH za sadzbu, nie za riadok', () => {
    // 3 × 0,333 € bez DPH pri 23 %: za riadok by vyšlo 3 × 0,08 = 0,24, za sadzbu 0,23
    const lines = [1, 2, 3].map(() => ({ quantity: 1, unitPrice: 0.333, vatRate: 23 }));
    expect(vatSummary(lines)).toEqual([{ rate: 23, base: 1, vat: 0.23 }]);
  });

  it('spočíta viac sadzieb a zľavu', () => {
    const t = totals([
      { quantity: 2, unitPrice: 100, vatRate: 23, discountPercent: 10 },
      { quantity: 1, unitPrice: 10, vatRate: 5 },
    ]);
    expect(t.rows).toEqual([
      { rate: 23, base: 180, vat: 41.4 },
      { rate: 5, base: 10, vat: 0.5 },
    ]);
    expect(t.total).toBe(231.9);
  });

  it('prepočíta cenu s DPH na bez DPH', () => {
    expect(netFromGross(123, 23)).toBeCloseTo(100, 10);
  });
});
