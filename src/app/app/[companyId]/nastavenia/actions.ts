'use server';

import { revalidatePath } from 'next/cache';
import { isCodeList, type Accounting, type CodeList, type RuleMatch } from '@/lib/accounting/codes';
import { deleteCodeItem, deleteRule, importCodeCsv, saveCodeItem, saveRule, type CodeItemInput } from '@/lib/accounting/service';
import { createInbox, deleteInboundEmail, reprocessInboundEmail, updateInbox } from '@/lib/inbound/service';
import { kickJobs } from '@/lib/jobs/runner';
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

// ── Číselníky a pravidlá (E6) ────────────────────────────────────

export const saveCodeItemAction = async (companyId: string, input: CodeItemInput, id?: string) =>
  isCodeList(input.list) ? run(companyId, (db) => saveCodeItem(db, companyId, input, id)) : ({ ok: false, error: 'Neznámy číselník.' } as const);
export const deleteCodeItemAction = async (companyId: string, id: string) => run(companyId, (db) => deleteCodeItem(db, companyId, id));

export async function importCodeCsvAction(companyId: string, list: CodeList, text: string) {
  if (!isCodeList(list)) return { ok: false as const, error: 'Neznámy číselník.' };
  const res = await importCodeCsv(await createClient(), companyId, list, text);
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath(`/app/${companyId}/nastavenia`);
  return { ok: true as const, imported: res.imported, errors: res.errors };
}

export const saveRuleAction = async (
  companyId: string,
  input: { name?: string | null; match: RuleMatch; accounting: Accounting; priority?: number; active?: boolean },
  id?: string,
) => run(companyId, (db) => saveRule(db, companyId, input, id));
export const deleteRuleAction = async (companyId: string, id: string) => run(companyId, (db) => deleteRule(db, companyId, id));

// ── Zberný e-mail (E7) ───────────────────────────────────────────

export const createInboxAction = async (companyId: string) => run(companyId, (db) => createInbox(db, companyId));
export const updateInboxAction = async (companyId: string, allowAll: boolean, senders: string) =>
  run(companyId, (db) => updateInbox(db, companyId, { allowAll, senders }));
export const deleteInboundEmailAction = async (companyId: string, emailId: string) =>
  run(companyId, (db) => deleteInboundEmail(db, companyId, emailId));

/** Spracovať e-mail znova (voliteľne povoliť odosielateľa); úloha beží hneď na pozadí. */
export async function reprocessInboundEmailAction(companyId: string, emailId: string, allowSender: boolean) {
  const res = await reprocessInboundEmail(await createClient(), companyId, emailId, { allowSender });
  if (!res.ok) return { ok: false as const, error: res.error };
  kickJobs([res.job.id]);
  revalidatePath(`/app/${companyId}/nastavenia`);
  return { ok: true as const, jobId: res.job.id };
}
