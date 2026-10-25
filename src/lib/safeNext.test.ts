import { describe, expect, it } from 'vitest';
import { inviteUrl } from './members/service';
import { safeNext } from './safeNext';

describe('safeNext', () => {
  it('pustí len relatívnu cestu v appke', () => {
    expect(safeNext('/pozvanka/abc')).toBe('/pozvanka/abc');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });

  it('odkaz pozvánky', () => {
    expect(inviteUrl('https://uctovnicek.vercel.app/', 'ab12')).toBe('https://uctovnicek.vercel.app/pozvanka/ab12');
  });
});
