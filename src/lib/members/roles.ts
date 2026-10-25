/** Názvy a popisy rolí pre UI (bez závislostí na serveri — používajú ich aj klientske komponenty). */
import { ROLES, type Role } from '../documentStatus';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Majiteľ',
  accountant: 'Účtovník',
  approver: 'Schvaľovateľ',
  viewer: 'Len na čítanie',
};
export const ROLE_HELP: Record<Role, string> = {
  owner: 'nahráva a potvrdzuje doklady, spravuje členov',
  accountant: 'schvaľuje, exportuje do MRP, pozýva',
  approver: 'schvaľuje a zamieta doklady',
  viewer: 'len prezerá',
};
export { ROLES };
export type { Role };
