'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DOCUMENTS_BUCKET } from '@/lib/db';
import { KINDS, PAYMENT_METHODS, STATUSES, SUBTYPES, VAT_MODES, type Status } from '@/lib/documentKinds';
import { canDelete, canTransition, editBlockedReason, isRole, type Role } from '@/lib/documentStatus';
import { normalizeAccounting, type Accounting } from '@/lib/accounting/codes';
import { periodLabel } from '@/lib/accounting/periods';
import { applyAccountingRules, periodCheck, saveRuleFromDocument } from '@/lib/accounting/service';
import { refreshDuplicateOf } from '@/lib/duplicates';
import { isValidIban, normalizeIban } from '@/lib/iban';
import { createClient } from '@/lib/supabase-server';
import { totals } from '@/lib/vat';

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const optText = z.string().trim().transform((s) => s || null).nullable();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal('').transform(() => null));

const partnerSchema = z.object({
  name: optText,
  ico: optText,
  dic: optText,
  ic_dph: optText,
  street: optText,
  city: optText,
  zip: optText,
  country_code: optText,
  iban: optText,
});

const documentInput = z.object({
  kind: z.enum(keys(KINDS)),
  subtype: z.enum(keys(SUBTYPES)),
  partner: partnerSchema,
  original_number: optText,
  variable_symbol: optText,
  constant_symbol: optText,
  issue_date: optDate,
  tax_point_date: optDate,
  due_date: optDate,
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()),
  total_amount: z.number().nullable(),
  payment_method: z.enum(keys(PAYMENT_METHODS)).nullable(),
  vat_mode: z.enum(keys(VAT_MODES)),
  note: optText,
  internal_note: optText,
  evidence_date: optDate.optional(),
  accounting: z.record(z.string(), z.string()).optional(),
  lines: z.array(
    z.object({
      name: z.string().trim().min(1),
      quantity: z.number(),
      unit: optText,
      unit_price: z.number(),
      vat_rate: z.number(),
    }),
  ),
});
export type DocumentInput = z.input<typeof documentInput>;

/** `evidenceDate` = návrh dátumu evidencie, keď obdobie dokladu je uzavreté. */
type Result = { ok: true } | { ok: false; error: string; evidenceDate?: string };

async function context(docId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Neprihlásený používateľ.');
  const { data: doc } = await supabase
    .from('documents')
    .select('id, company_id, status, partner_id, prices_with_vat')
    .eq('id', docId)
    .maybeSingle();
  if (!doc) throw new Error('Doklad neexistuje alebo k nemu nemáš prístup.');
  const { data: member } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', doc.company_id)
    .eq('user_id', user.id)
    .maybeSingle();
  const role: Role | null = isRole(member?.role) ? member.role : null;
  return { supabase, doc, role };
}

const fail = (error: string): Result => ({ ok: false, error });

/** Nájde partnera podľa IČO (alebo presného názvu, ak IČO chýba) a aktualizuje / založí ho. */
async function upsertPartner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  p: z.infer<typeof partnerSchema>,
): Promise<string | null> {
  if (!p.name && !p.ico) return null;
  let query = supabase.from('partners').select('id').eq('company_id', companyId).limit(1);
  query = p.ico ? query.eq('ico', p.ico) : query.eq('name', p.name!);
  const { data: found } = await query.maybeSingle();
  const row = {
    name: p.name ?? p.ico!,
    ico: p.ico,
    dic: p.dic,
    ic_dph: p.ic_dph,
    iban: p.iban,
    address: { street: p.street, city: p.city, zip: p.zip, country: p.country_code },
  };
  if (found) {
    await supabase.from('partners').update(row).eq('id', found.id);
    return found.id;
  }
  const { data: created, error } = await supabase
    .from('partners')
    .insert({ ...row, company_id: companyId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

async function save(docId: string, input: DocumentInput, confirm: boolean): Promise<Result> {
  const parsed = documentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `Neplatné údaje: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}` };
  }
  const d = parsed.data;
  try {
    const { supabase, doc, role } = await context(docId);
    const blocked = editBlockedReason(doc.status, role);
    if (blocked) return fail(blocked);
    if (confirm && doc.status === 'unprocessed' && !canTransition('unprocessed', 'ready', role)) {
      return fail('Na potvrdenie dokladu nemáš oprávnenie.');
    }
    if (d.partner.iban) d.partner.iban = normalizeIban(d.partner.iban);

    // Spracovaný doklad nesmie patriť do uzavretého obdobia (DB trigger) → ponúknuť dátum evidencie v otvorenom.
    if (confirm || doc.status !== 'unprocessed') {
      const closed = await periodCheck(supabase, doc.company_id, d);
      if (closed) {
        return {
          ok: false,
          error: `Obdobie ${periodLabel(closed.period)} je uzavreté. Zaeviduj doklad do otvoreného obdobia.`,
          evidenceDate: closed.evidenceDate,
        };
      }
    }

    if (confirm) {
      const problems: string[] = [];
      if (!d.issue_date) problems.push('dátum vystavenia');
      if (!d.partner.name) problems.push('partner');
      if (d.total_amount == null && !d.lines.length) problems.push('suma alebo položky');
      if (d.partner.iban && !isValidIban(d.partner.iban)) problems.push('platný IBAN partnera');
      if (problems.length) return { ok: false, error: `Na potvrdenie chýba: ${problems.join(', ')}.` };
    }

    const computed = totals(
      d.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price, vatRate: l.vat_rate })),
      { pricesWithVat: doc.prices_with_vat },
    );
    const partnerId = confirm ? await upsertPartner(supabase, doc.company_id, d.partner) : doc.partner_id;

    const { error } = await supabase
      .from('documents')
      .update({
        kind: d.kind,
        subtype: d.subtype,
        partner_id: partnerId,
        partner_snapshot: d.partner,
        original_number: d.original_number,
        variable_symbol: d.variable_symbol,
        constant_symbol: d.constant_symbol,
        issue_date: d.issue_date,
        tax_point_date: d.tax_point_date,
        due_date: d.due_date,
        currency: d.currency,
        total_amount: d.total_amount ?? (d.lines.length ? computed.total : null),
        payment_method: d.payment_method,
        vat_mode: d.vat_mode,
        note: d.note,
        internal_note: d.internal_note,
        ...(d.evidence_date !== undefined ? { evidence_date: d.evidence_date } : {}),
        // Účtovné údaje mení len účtovník (ostatným sa ich hodnoty nezobrazujú → nič neprepíšu).
        ...(role === 'accountant' && d.accounting ? { accounting: normalizeAccounting(d.accounting) } : {}),
        ...(confirm && doc.status === 'unprocessed' ? { status: 'ready' } : {}),
      })
      .eq('id', docId);
    if (error) return { ok: false, error: error.message };

    await supabase.from('document_lines').delete().eq('document_id', docId);
    if (d.lines.length) {
      const { error: lineError } = await supabase.from('document_lines').insert(
        d.lines.map((l, i) => ({ ...l, position: i, document_id: docId, company_id: doc.company_id })),
      );
      if (lineError) return { ok: false, error: lineError.message };
    }
    await supabase.from('document_history').insert({
      document_id: docId,
      company_id: doc.company_id,
      diff: { action: confirm ? 'confirmed' : 'saved' },
    });
    await refreshDuplicateOf(supabase, docId);
    await applyAccountingRules(supabase, docId);
    revalidatePath(`/app/${doc.company_id}`, 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveDocument(docId: string, input: DocumentInput) {
  return save(docId, input, false);
}

export async function confirmDocument(docId: string, input: DocumentInput) {
  return save(docId, input, true);
}

/**
 * Zmena stavu podľa `lib/documentStatus.ts` (kto smie aký prechod). Údaje dokladu sa nemenia;
 * potvrdenie s uložením údajov je `confirmDocument`, export rieši stránka exportu.
 */
export async function changeStatus(docId: string, to: Status): Promise<Result> {
  try {
    const { supabase, doc, role } = await context(docId);
    if (!canTransition(doc.status, to, role)) {
      return fail(`Zmena stavu „${STATUSES[doc.status as Status] ?? doc.status}" → „${STATUSES[to] ?? to}" nie je povolená.`);
    }
    if (to === 'exported') return fail('Doklad sa exportuje cez export, nie ručne.');
    const { error } = await supabase.from('documents').update({ status: to }).eq('id', docId).eq('status', doc.status);
    if (error) return fail(error.message);
    await supabase.from('document_history').insert({
      document_id: docId,
      company_id: doc.company_id,
      diff: { action: 'status', from: doc.status, to },
    });
    revalidatePath(`/app/${doc.company_id}`, 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Vráti doklad medzi nespracované (napr. na opätovné vyťaženie). */
export async function reopenDocument(docId: string): Promise<Result> {
  return changeStatus(docId, 'unprocessed');
}

/** „Nie je to duplikát" — upozornenie na možný duplikát sa už nezobrazí. */
export async function ignoreDuplicate(docId: string): Promise<Result> {
  try {
    const { supabase, doc, role } = await context(docId);
    if (!role || role === 'viewer') return fail('Máš prístup len na čítanie.');
    const { error } = await supabase.from('documents').update({ duplicate_ignored: true }).eq('id', docId);
    if (error) return fail(error.message);
    revalidatePath(`/app/${doc.company_id}`, 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function deleteDocument(docId: string): Promise<Result> {
  try {
    const { supabase, doc, role } = await context(docId);
    if (!canDelete(doc.status, role)) return fail(editBlockedReason(doc.status, role) ?? 'Doklad sa nedá zmazať.');
    const { data: files } = await supabase.from('document_files').select('storage_path').eq('document_id', docId);
    if (files?.length) await supabase.storage.from(DOCUMENTS_BUCKET).remove(files.map((f) => f.storage_path));
    const { error } = await supabase.from('documents').delete().eq('id', docId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/app/${doc.company_id}`, 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** „Uložiť ako pravidlo": tento partner (IČO) + druh dokladu → tieto účtovné údaje. */
export async function saveAccountingRuleFromDocument(docId: string, accounting: Accounting): Promise<Result> {
  try {
    const { supabase, doc, role } = await context(docId);
    if (role !== 'accountant' && role !== 'owner') return fail('Pravidlá spravuje majiteľ alebo účtovník.');
    const { data } = await supabase.from('documents').select('kind, partner_snapshot').eq('id', docId).single();
    const partner = (data?.partner_snapshot ?? {}) as { ico?: string | null; name?: string | null };
    if (!partner.ico) return fail('Partner nemá IČO — pravidlo sa dá vytvoriť v Nastaveniach s podmienkou na text.');
    const res = await saveRuleFromDocument(supabase, doc.company_id, partner.ico, data!.kind, partner.name ?? null, accounting);
    if (!res.ok) return fail(res.error);
    revalidatePath(`/app/${doc.company_id}`, 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
