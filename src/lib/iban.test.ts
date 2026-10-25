import { describe, expect, it } from 'vitest';
import { formatIban, isValidIban } from './iban';

describe('iban', () => {
  it('overí platný slovenský IBAN aj s medzerami', () => {
    // príklad z registra IBAN (SWIFT IBAN Registry) pre SK
    expect(isValidIban('SK31 1200 0000 1987 4263 7541')).toBe(true);
  });
  it('odmietne zlú kontrolnú číslicu a dĺžku', () => {
    expect(isValidIban('SK32 1200 0000 1987 4263 7541')).toBe(false);
    expect(isValidIban('SK31 1200 0000 1987 4263 754')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
  it('formátuje po štvoriciach', () => {
    expect(formatIban('sk3112000000198742637541')).toBe('SK31 1200 0000 1987 4263 7541');
  });
});
