/** Spoločné pre služby v `lib/<modul>/service.ts`: typ Supabase klienta a rola prihláseného používateľa vo firme. */
import { isRole, type Role } from './documentStatus';
import type { createClient } from './supabase-server';

export type Db = Awaited<ReturnType<typeof createClient>>;

export async function memberRole(supabase: Db, companyId: string): Promise<Role | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .maybeSingle();
  return isRole(data?.role) ? data.role : null;
}
