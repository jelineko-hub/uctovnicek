/**
 * Členovia firmy, pozvánky a prehľad firiem (koncept P1.1, P1.2).
 * Volajú ho server actions aj API (`/api/companies/:id/invites`, `/api/invites/:token/accept`, `/api/overview`).
 * Pozvánka = odkaz `/pozvanka/<token>` (zatiaľ ho používateľ pošle sám; e-mail v E7).
 */
import { isRole, type Role } from '../documentStatus';
import { memberRole, type Db } from '../membership';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };
const fail = (code: string, error: string): { ok: false; code: string; error: string } => ({ ok: false, code, error });

export { ROLE_HELP, ROLE_LABELS, ROLES } from './roles';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const canInvite = (role: Role | null) => role === 'owner' || role === 'accountant';
export const canManageMembers = (role: Role | null) => role === 'owner';

export const inviteUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/pozvanka/${token}`;

export async function createInvite(
  supabase: Db,
  companyId: string,
  emailInput: string,
  role: string,
): Promise<Result<{ token: string; email: string }>> {
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL.test(email)) return fail('invalid_email', 'Neplatný e-mail.');
  if (!isRole(role)) return fail('invalid_role', 'Neplatná rola.');
  if (!canInvite(await memberRole(supabase, companyId))) return fail('forbidden', 'Pozývať môže majiteľ alebo účtovník.');

  const members = await listMembers(supabase, companyId);
  if (members.some((m) => m.email?.toLowerCase() === email)) return fail('already_member', 'Tento e-mail už je členom firmy.');

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('company_invites')
    .insert({ company_id: companyId, email, role, invited_by: user?.id })
    .select('token')
    .single();
  if (error) return fail('db', error.message);
  return { ok: true, token: data.token, email };
}

export async function deleteInvite(supabase: Db, companyId: string, inviteId: string): Promise<Result> {
  const { error } = await supabase.from('company_invites').delete().eq('id', inviteId).eq('company_id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}

export interface Member {
  user_id: string;
  email: string | null;
  role: Role;
  created_at: string;
}

export async function listMembers(supabase: Db, companyId: string): Promise<Member[]> {
  const { data } = await supabase.rpc('company_member_list', { p_company: companyId });
  return ((data ?? []) as Member[]).filter((m) => isRole(m.role));
}

export async function listInvites(supabase: Db, companyId: string) {
  const { data } = await supabase
    .from('company_invites')
    .select('id, email, role, token, expires_at, created_at')
    .eq('company_id', companyId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function changeMemberRole(supabase: Db, companyId: string, userId: string, role: string): Promise<Result> {
  if (!isRole(role)) return fail('invalid_role', 'Neplatná rola.');
  if (!canManageMembers(await memberRole(supabase, companyId))) return fail('forbidden', 'Členov spravuje majiteľ.');
  const { data, error } = await supabase
    .from('company_members')
    .update({ role })
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return fail('db', error.message);
  return data?.length ? { ok: true } : fail('not_found', 'Člen neexistuje.');
}

export async function removeMember(supabase: Db, companyId: string, userId: string): Promise<Result> {
  if (!canManageMembers(await memberRole(supabase, companyId))) return fail('forbidden', 'Členov spravuje majiteľ.');
  const { data, error } = await supabase
    .from('company_members')
    .delete()
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return fail('db', error.message);
  return data?.length ? { ok: true } : fail('not_found', 'Člen neexistuje.');
}

export interface InvitePreview {
  company_name: string;
  role: Role;
  email: string;
  expired: boolean;
  accepted: boolean;
}

export async function previewInvite(supabase: Db, token: string): Promise<InvitePreview | null> {
  const { data } = await supabase.rpc('invite_preview', { p_token: token });
  return ((data ?? []) as InvitePreview[])[0] ?? null;
}

export async function acceptInvite(supabase: Db, token: string): Promise<Result<{ companyId: string }>> {
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
  if (error) {
    const code = error.code === '42501' ? 'wrong_email' : error.code === 'P0002' ? 'not_found' : error.code === '28000' ? 'unauthorized' : 'invalid';
    return fail(code, error.message);
  }
  return { ok: true, companyId: data as string };
}

export interface OverviewRow {
  company_id: string;
  name: string;
  ico: string | null;
  role: Role;
  unprocessed: number;
  ready: number;
  approved: number;
  rejected: number;
  overdue_received: number;
  overdue_issued: number;
  last_export_at: string | null;
  last_export_status: string | null;
  /** Posledný uzavretý mesiac 'YYYY-MM'. */
  last_closed_period: string | null;
}

export async function companyOverview(supabase: Db): Promise<OverviewRow[]> {
  const { data } = await supabase.rpc('company_overview');
  return (data ?? []) as OverviewRow[];
}
