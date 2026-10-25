import { describe, expect, it } from 'vitest';
import { allowedTransitions, canDelete, canEdit, canTransition, editBlockedReason, isLocked } from './documentStatus';

describe('documentStatus', () => {
  it('hlavný tok unprocessed → ready → approved → exported → archived robí účtovník', () => {
    expect(canTransition('unprocessed', 'ready', 'accountant')).toBe(true);
    expect(canTransition('ready', 'approved', 'accountant')).toBe(true);
    expect(canTransition('approved', 'exported', 'accountant')).toBe(true);
    expect(canTransition('exported', 'archived', 'accountant')).toBe(true);
  });

  it('majiteľ dokladá len po ready', () => {
    expect(allowedTransitions('unprocessed', 'owner')).toEqual(['ready']);
    expect(allowedTransitions('ready', 'owner')).toEqual(['unprocessed']);
    expect(allowedTransitions('rejected', 'owner')).toEqual(['unprocessed']);
    expect(canTransition('ready', 'approved', 'owner')).toBe(false);
    expect(allowedTransitions('approved', 'owner')).toEqual([]);
  });

  it('schvaľovateľ schváli, zamietne a vráti, ale neexportuje', () => {
    expect(allowedTransitions('ready', 'approver').sort()).toEqual(['approved', 'rejected', 'unprocessed']);
    expect(allowedTransitions('approved', 'approver').sort()).toEqual(['ready', 'rejected']);
    expect(canTransition('approved', 'exported', 'approver')).toBe(false);
  });

  it('viewer a nečlen nesmú nič', () => {
    for (const from of ['unprocessed', 'ready', 'approved', 'rejected', 'exported']) {
      expect(allowedTransitions(from, 'viewer')).toEqual([]);
      expect(allowedTransitions(from, null)).toEqual([]);
    }
  });

  it('neplatné prechody nepustí nikomu', () => {
    expect(canTransition('unprocessed', 'exported', 'accountant')).toBe(false);
    expect(canTransition('exported', 'approved', 'accountant')).toBe(false);
    expect(canTransition('archived', 'exported', 'accountant')).toBe(false);
    expect(canTransition('rejected', 'approved', 'accountant')).toBe(false);
  });

  it('exportovaný a archivovaný doklad je zamknutý pre všetkých', () => {
    expect(isLocked('exported')).toBe(true);
    expect(isLocked('archived')).toBe(true);
    expect(isLocked('approved')).toBe(false);
    for (const role of ['owner', 'accountant', 'approver', 'viewer'] as const) {
      expect(canEdit('exported', role)).toBe(false);
      expect(canDelete('archived', role)).toBe(false);
    }
    expect(editBlockedReason('exported', 'accountant')).toMatch(/zamknutý/);
  });

  it('úpravy podľa roly', () => {
    expect(canEdit('ready', 'owner')).toBe(true);
    expect(canEdit('approved', 'owner')).toBe(false);
    expect(canEdit('approved', 'accountant')).toBe(true);
    expect(canEdit('rejected', 'accountant')).toBe(false);
    expect(canEdit('unprocessed', 'viewer')).toBe(false);
  });
});
