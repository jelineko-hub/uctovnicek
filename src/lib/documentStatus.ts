/**
 * Stavový automat dokladu: povolené prechody a kto ich smie urobiť.
 * Jediný zdroj pravdy pre server actions, API aj UI (tlačidlá). Hodnoty stavov = `STATUSES` v documentKinds.ts.
 *
 *   unprocessed → ready → approved → exported → archived
 *   ready | approved → rejected → unprocessed;  approved → ready (vrátenie na kontrolu);  ready → unprocessed
 *
 * Doklad v stave `exported` / `archived` je zamknutý (DB trigger `documents_reject_locked_update`).
 */
import type { Status } from './documentKinds';

export const ROLES = ['owner', 'accountant', 'approver', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const PREPARERS: Role[] = ['owner', 'approver', 'accountant'];
const CHECKERS: Role[] = ['approver', 'accountant'];

/** [z, do, kto] — `owner` po `ready`, `approver` po `approved`, `accountant` všetko, `viewer` nič. */
const RULES: [Status, Status, Role[]][] = [
  ['unprocessed', 'ready', PREPARERS],
  ['ready', 'unprocessed', PREPARERS],
  ['rejected', 'unprocessed', PREPARERS],
  ['ready', 'approved', CHECKERS],
  ['ready', 'rejected', CHECKERS],
  ['approved', 'rejected', CHECKERS],
  ['approved', 'ready', CHECKERS],
  ['approved', 'exported', ['accountant']],
  ['exported', 'archived', ['accountant']],
];

export const LOCKED_STATUSES: readonly Status[] = ['exported', 'archived'];

export const isLocked = (status: string) => (LOCKED_STATUSES as readonly string[]).includes(status);

export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r);

export function canTransition(from: string, to: string, role: Role | null): boolean {
  if (!role) return false;
  return RULES.some(([f, t, roles]) => f === from && t === to && roles.includes(role));
}

/** Cieľové stavy, do ktorých môže daná rola doklad presunúť. */
export function allowedTransitions(from: string, role: Role | null): Status[] {
  if (!role) return [];
  return RULES.filter(([f, , roles]) => f === from && roles.includes(role)).map(([, t]) => t);
}

/** Úprava údajov dokladu: nie zamknutý, nie zamietnutý (najprv vrátiť), majiteľ len do `ready`. */
export function canEdit(status: string, role: Role | null): boolean {
  if (!role || role === 'viewer' || isLocked(status) || status === 'rejected') return false;
  if (role === 'owner') return status === 'unprocessed' || status === 'ready';
  return true;
}

/** Zmazať smie ten, kto smie upravovať; zamknutý doklad nikto. */
export const canDelete = canEdit;

/** Dôvod, prečo sa doklad nedá meniť (text pre UI aj chybu servera), alebo null. */
export function editBlockedReason(status: string, role: Role | null): string | null {
  if (canEdit(status, role)) return null;
  if (isLocked(status)) return 'Doklad je exportovaný a zamknutý — nedá sa meniť.';
  if (!role || role === 'viewer') return 'Máš prístup len na čítanie.';
  if (status === 'rejected') return 'Zamietnutý doklad najprv vráť medzi nespracované.';
  return 'Doklad už je schválený — zmeniť ho môže účtovník.';
}
