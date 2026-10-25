/**
 * Číselníky, pravidlá automatického účtovania a účtovné obdobia nad DB (koncept P1.3–P1.5).
 * Volajú ho server actions, API (`/api/companies/:id/code-lists`, `/periods`), vyťaženie a eKasa.
 */
import { isRole } from '../documentStatus';
import { memberRole, type Db } from '../membership';
import {
  findRule,
  isEmptyAccounting,
  normalizeAccounting,
  parseCodeCsv,
  suggestFromHistory,
  validateCode,
  type Accounting,
  type CodeItem,
  type CodeList,
  type Rule,
  type RuleMatch,
} from './codes';
import { documentPeriodDate, nextOpenEvidenceDate, periodOf } from './periods';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };
const fail = (code: string, error: string): { ok: false; code: string; error: string } => ({ ok: false, code, error });

async function requireRole(supabase: Db, companyId: string, roles: string[], msg: string) {
  const role = await memberRole(supabase, companyId);
  return isRole(role) && roles.includes(role) ? null : fail('forbidden', msg);
}

// ── Číselníky ────────────────────────────────────────────────────

export async function loadCodeItems(supabase: Db, companyId: string): Promise<CodeItem[]> {
  const { data } = await supabase
    .from('company_code_lists')
    .select('id, list, code, name, kinds, is_default, active, sort')
    .eq('company_id', companyId)
    .order('list')
    .order('sort')
    .order('code');
  return (data ?? []) as CodeItem[];
}

export interface CodeItemInput {
  list: CodeList;
  code: string;
  name?: string | null;
  kinds?: string[] | null;
  is_default?: boolean;
  active?: boolean;
}

/** Predvolená môže byť len jedna položka na (zoznam, druh) — ostatné s prekrývajúcimi druhmi sa odznačia. */
async function clearOtherDefaults(supabase: Db, companyId: string, list: CodeList, kinds: string[] | null, keepId: string) {
  const items = (await loadCodeItems(supabase, companyId)).filter((i) => i.list === list && i.is_default && i.id !== keepId);
  const overlap = (a: string[] | null) => !a?.length || !kinds?.length || a.some((k) => kinds.includes(k));
  for (const i of items.filter((i) => overlap(i.kinds))) {
    await supabase.from('company_code_lists').update({ is_default: false }).eq('id', i.id).eq('company_id', companyId);
  }
}

export async function saveCodeItem(supabase: Db, companyId: string, input: CodeItemInput, id?: string): Promise<Result> {
  const denied = await requireRole(supabase, companyId, ['owner', 'accountant'], 'Číselníky spravuje majiteľ alebo účtovník.');
  if (denied) return denied;
  const err = validateCode(input.list, input.code);
  if (err) return fail('invalid_code', err);
  const row = {
    list: input.list,
    code: input.code.trim(),
    name: input.name?.trim() || null,
    kinds: input.kinds?.length ? input.kinds : null,
    is_default: !!input.is_default,
    active: input.active ?? true,
  };
  const q = id
    ? supabase.from('company_code_lists').update(row).eq('id', id).eq('company_id', companyId).select('id').single()
    : supabase.from('company_code_lists').insert({ ...row, company_id: companyId }).select('id').single();
  const { data, error } = await q;
  if (error) return fail('db', error.code === '23505' ? `Kód ${row.code} už v číselníku je.` : error.message);
  if (row.is_default) await clearOtherDefaults(supabase, companyId, row.list, row.kinds, data.id);
  return { ok: true };
}

export async function deleteCodeItem(supabase: Db, companyId: string, id: string): Promise<Result> {
  const denied = await requireRole(supabase, companyId, ['owner', 'accountant'], 'Číselníky spravuje majiteľ alebo účtovník.');
  if (denied) return denied;
  const { error } = await supabase.from('company_code_lists').delete().eq('id', id).eq('company_id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}

/** CSV `kód;názov` → doplní nové a aktualizuje názvy existujúcich kódov. */
export async function importCodeCsv(
  supabase: Db,
  companyId: string,
  list: CodeList,
  text: string,
): Promise<Result<{ imported: number; errors: string[] }>> {
  const denied = await requireRole(supabase, companyId, ['owner', 'accountant'], 'Číselníky spravuje majiteľ alebo účtovník.');
  if (denied) return denied;
  const { rows, errors } = parseCodeCsv(list, text);
  if (!rows.length) return fail('empty', errors[0] ?? 'Súbor neobsahuje žiadny kód.');
  const { error } = await supabase
    .from('company_code_lists')
    .upsert(rows.map((r, i) => ({ company_id: companyId, list, code: r.code, name: r.name, sort: i })), {
      onConflict: 'company_id,list,code',
    });
  if (error) return fail('db', error.message);
  return { ok: true, imported: rows.length, errors };
}

// ── Pravidlá ─────────────────────────────────────────────────────

export async function loadRules(supabase: Db, companyId: string): Promise<Rule[]> {
  const { data } = await supabase
    .from('accounting_rules')
    .select('id, name, priority, active, match, apply')
    .eq('company_id', companyId)
    .order('priority')
    .order('created_at');
  return (data ?? []).map((r) => ({ ...r, apply: { accounting: normalizeAccounting((r.apply as Rule['apply'])?.accounting) } })) as Rule[];
}

export async function saveRule(
  supabase: Db,
  companyId: string,
  input: { name?: string | null; match: RuleMatch; accounting: Accounting; priority?: number; active?: boolean },
  id?: string,
): Promise<Result<{ id: string }>> {
  const denied = await requireRole(supabase, companyId, ['owner', 'accountant'], 'Pravidlá spravuje majiteľ alebo účtovník.');
  if (denied) return denied;
  const match: RuleMatch = {
    ...(input.match.partner_ico?.replace(/\D/g, '') ? { partner_ico: input.match.partner_ico.replace(/\D/g, '') } : {}),
    ...(input.match.kind ? { kind: input.match.kind } : {}),
    ...(input.match.text_contains?.trim() ? { text_contains: input.match.text_contains.trim() } : {}),
  };
  if (!Object.keys(match).length) return fail('invalid_rule', 'Pravidlo musí mať aspoň jednu podmienku (partner, druh alebo text).');
  const accounting = normalizeAccounting(input.accounting);
  if (isEmptyAccounting(accounting)) return fail('invalid_rule', 'Pravidlo nič nenastavuje — vyplň aspoň jednu hodnotu.');
  const row = { name: input.name?.trim() || null, match, apply: { accounting }, priority: input.priority ?? 100, active: input.active ?? true };
  const { data, error } = id
    ? await supabase.from('accounting_rules').update(row).eq('id', id).eq('company_id', companyId).select('id').single()
    : await supabase.from('accounting_rules').insert({ ...row, company_id: companyId }).select('id').single();
  return error ? fail('db', error.message) : { ok: true, id: data.id };
}

/** „Uložiť ako pravidlo" z editora: partner (IČO) + druh → aktualizuje existujúce pravidlo s rovnakou podmienkou. */
export async function saveRuleFromDocument(supabase: Db, companyId: string, partnerIco: string, kind: string, partnerName: string | null, accounting: Accounting) {
  const ico = partnerIco.replace(/\D/g, '');
  const existing = (await loadRules(supabase, companyId)).find(
    (r) => r.match.partner_ico === ico && r.match.kind === kind && !r.match.text_contains,
  );
  return saveRule(supabase, companyId, { name: partnerName, match: { partner_ico: ico, kind }, accounting, priority: existing?.priority ?? 100 }, existing?.id);
}

export async function deleteRule(supabase: Db, companyId: string, id: string): Promise<Result> {
  const denied = await requireRole(supabase, companyId, ['owner', 'accountant'], 'Pravidlá spravuje majiteľ alebo účtovník.');
  if (denied) return denied;
  const { error } = await supabase.from('accounting_rules').delete().eq('id', id).eq('company_id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}

async function ruleContext(supabase: Db, docId: string) {
  const { data: doc } = await supabase
    .from('documents')
    .select('id, company_id, kind, partner_snapshot, note, accounting')
    .eq('id', docId)
    .maybeSingle();
  if (!doc) return null;
  const { data: lines } = await supabase.from('document_lines').select('name').eq('document_id', docId);
  const partner = (doc.partner_snapshot ?? {}) as { name?: string | null; ico?: string | null };
  return {
    doc,
    ctx: {
      partner_ico: partner.ico ?? null,
      kind: doc.kind as string,
      text: [partner.name, doc.note, ...(lines ?? []).map((l) => l.name)].filter(Boolean).join(' '),
    },
  };
}

/**
 * Po vyťažení / eKasa / zmene partnera: ak doklad nemá účtovné údaje, nastaví ich podľa pravidla.
 * Ručne zadané hodnoty neprepisuje. Vráti použité pravidlo alebo null.
 */
export async function applyAccountingRules(supabase: Db, docId: string): Promise<Rule | null> {
  const c = await ruleContext(supabase, docId);
  if (!c || !isEmptyAccounting(normalizeAccounting(c.doc.accounting))) return null;
  const rule = findRule(await loadRules(supabase, c.doc.company_id), c.ctx);
  if (!rule?.apply.accounting) return null;
  await supabase.from('documents').update({ accounting: rule.apply.accounting }).eq('id', docId);
  return rule;
}

/** Návrh z posledných 5 dokladov toho istého partnera (IČO) a druhu, ktoré majú účtovné údaje. */
export async function suggestAccounting(supabase: Db, companyId: string, kind: string, partnerIco: string | null, excludeId: string): Promise<Accounting> {
  if (!partnerIco) return {};
  const { data } = await supabase
    .from('documents')
    .select('accounting')
    .eq('company_id', companyId)
    .eq('kind', kind)
    .eq('partner_snapshot->>ico', partnerIco)
    .neq('id', excludeId)
    .neq('accounting', '{}')
    .order('created_at', { ascending: false })
    .limit(5);
  return suggestFromHistory((data ?? []).map((d) => normalizeAccounting(d.accounting)));
}

// ── Obdobia ──────────────────────────────────────────────────────

export async function closedPeriods(supabase: Db, companyId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('accounting_periods')
    .select('year, month')
    .eq('company_id', companyId)
    .eq('status', 'closed');
  return new Set((data ?? []).map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`));
}

/** Kontrola pred potvrdením/uložením spracovaného dokladu: uzavreté obdobie → návrh dátumu evidencie. */
export async function periodCheck(supabase: Db, companyId: string, dates: Parameters<typeof documentPeriodDate>[0]) {
  const period = periodOf(documentPeriodDate(dates));
  if (!period) return null;
  const closed = await closedPeriods(supabase, companyId);
  return closed.has(period) ? { period, evidenceDate: nextOpenEvidenceDate(period, closed) } : null;
}

export async function setPeriodStatus(supabase: Db, companyId: string, period: string, status: 'open' | 'closed'): Promise<Result> {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return fail('invalid_period', 'Neplatné obdobie.');
  const denied = await requireRole(
    supabase,
    companyId,
    status === 'closed' ? ['owner', 'accountant'] : ['accountant'],
    status === 'closed' ? 'Uzavrieť obdobie môže majiteľ alebo účtovník.' : 'Otvoriť obdobie môže len účtovník.',
  );
  if (denied) return denied;
  const { error } = await supabase
    .from('accounting_periods')
    .upsert({ company_id: companyId, year: Number(m[1]), month: Number(m[2]), status }, { onConflict: 'company_id,year,month' });
  return error ? fail('db', error.message) : { ok: true };
}
