'use server';

import { revalidatePath } from 'next/cache';
import { changeMemberRole, createInvite, deleteInvite, removeMember } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';

type Result = { ok: true; token?: string } | { ok: false; error: string };

async function run(companyId: string, fn: (db: Awaited<ReturnType<typeof createClient>>) => Promise<{ ok: boolean; error?: string; token?: string }>): Promise<Result> {
  const res = await fn(await createClient());
  if (!res.ok) return { ok: false, error: res.error ?? 'Chyba' };
  revalidatePath(`/app/${companyId}/nastavenia`);
  return { ok: true, token: res.token };
}

export const createInviteAction = async (companyId: string, email: string, role: string) =>
  run(companyId, (db) => createInvite(db, companyId, email, role));
export const deleteInviteAction = async (companyId: string, inviteId: string) =>
  run(companyId, (db) => deleteInvite(db, companyId, inviteId));
export const changeRoleAction = async (companyId: string, userId: string, role: string) =>
  run(companyId, (db) => changeMemberRole(db, companyId, userId, role));
export const removeMemberAction = async (companyId: string, userId: string) =>
  run(companyId, (db) => removeMember(db, companyId, userId));
