/**
 * Export do MRP-K/S nad databázou: náhľad, vytvorenie, zrušenie a stav exportu.
 * Zdieľajú ho server actions (stránka Export) aj API `/api/companies/:id/exports*` (mobil, API-first).
 * Beží s klientom používateľa (RLS); oprávnenia podľa roly z `lib/documentStatus.ts`.
 */
import { DOCUMENTS_BUCKET } from '../db';
import { canTransition, isRole, type Role } from '../documentStatus';
import type { createClient } from '../supabase-server';
import { buildMrpXml, MrpExportError } from '../mrp/xml';
import {
  checkDocument,
  EXPORT_KINDS,
  exportFileName,
  mrpOptions,
  periodRange,
  toMrpInvoice,
  type DocumentCheck,
  type ExportDocument,
  type ExportKind,
  type MrpSettings,
} from './mrpDocument';

export type Db = Awaited<ReturnType<typeof createClient>>;

export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string; problems?: Problem[] };
export interface Problem {
  id: string;
  label: string;
  errors: string[];
}

const DOC_SELECT =
  'id, kind, subtype, status, number, original_number, variable_symbol, constant_symbol, issue_date, tax_point_date, delivery_date, due_date, currency, total_amount, vat_mode, note, partner_snapshot';

const fail = (code: string, error: string, problems?: Problem[]): { ok: false; code: string; error: string; problems?: Problem[] } => ({
  ok: false,
  code,
  error,
  ...(problems ? { problems } : {}),
});

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

export const canExport = (role: Role | null) => canTransition('approved', 'exported', role);

async function companyExportSettings(supabase: Db, companyId: string) {
  const { data } = await supabase.from('companies').select('settings, vat_payer').eq('id', companyId).maybeSingle();
  const settings = ((data?.settings ?? {}) as { mrp?: MrpSettings }).mrp ?? {};
  return { settings, vatPayer: data?.vat_payer ?? false };
}

/** Doklady v období podľa DUZP, inak dátumu vystavenia. */
function inPeriod(from: string, to: string) {
  return `and(tax_point_date.gte.${from},tax_point_date.lte.${to}),and(tax_point_date.is.null,issue_date.gte.${from},issue_date.lte.${to})`;
}

async function withLines(supabase: Db, docs: Omit<ExportDocument, 'lines'>[]): Promise<ExportDocument[]> {
  if (!docs.length) return [];
  const { data: lines } = await supabase
    .from('document_lines')
    .select('document_id, name, quantity, unit, unit_price, vat_rate, discount_percent')
    .in('document_id', docs.map((d) => d.id))
    .order('position');
  return docs.map((d) => ({ ...d, lines: (lines ?? []).filter((l) => l.document_id === d.id) }));
}

const docLabel = (d: ExportDocument) =>
  [d.partner_snapshot?.name, d.original_number].filter(Boolean).join(' · ') || d.id.slice(0, 8);

export interface PreviewRow {
  doc: ExportDocument;
  check: DocumentCheck;
}

/** Náhľad exportu: schválené doklady v období s kontrolou + počet ešte neschválených. */
export async function exportPreview(supabase: Db, companyId: string, kind: ExportKind, period: string) {
  const range = periodRange(period);
  if (!range) return { rows: [] as PreviewRow[], pending: 0, settings: {} as MrpSettings };
  const [{ settings, vatPayer }, { data: docs }, { count: pending }] = await Promise.all([
    companyExportSettings(supabase, companyId),
    supabase
      .from('documents')
      .select(DOC_SELECT)
      .eq('company_id', companyId)
      .eq('kind', kind)
      .eq('status', 'approved')
      .or(inPeriod(range.from, range.to))
      .order('issue_date'),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('kind', kind)
      .in('status', ['unprocessed', 'ready'])
      .or(inPeriod(range.from, range.to)),
  ]);
  const full = await withLines(supabase, (docs ?? []) as Omit<ExportDocument, 'lines'>[]);
  return {
    rows: full.map((doc) => ({ doc, check: checkDocument(doc, kind, settings, vatPayer) })),
    pending: pending ?? 0,
    settings,
  };
}

/**
 * Vytvorí export: XML do Storage, záznam v `exports`, doklady → `exported` (+ `export_id`, zámok triggerom).
 * Ak nie sú zadané `documentIds`, exportujú sa všetky schválené doklady obdobia.
 */
export async function createExport(
  supabase: Db,
  input: { companyId: string; kind: ExportKind; period: string; documentIds?: string[] },
): Promise<ServiceResult<{ exportId: string; fileName: string; count: number }>> {
  const { companyId, kind, period } = input;
  const range = periodRange(period);
  if (!range) return fail('invalid_period', 'Neplatné obdobie (očakáva sa RRRR-MM).');
  if (!canExport(await memberRole(supabase, companyId))) return fail('forbidden', 'Exportovať môže len účtovník firmy.');

  let query = supabase
    .from('documents')
    .select(DOC_SELECT)
    .eq('company_id', companyId)
    .eq('kind', kind)
    .eq('status', 'approved')
    .or(inPeriod(range.from, range.to));
  if (input.documentIds) {
    if (!input.documentIds.length) return fail('empty', 'Nie je vybraný žiadny doklad.');
    query = query.in('id', input.documentIds);
  }
  const { data: docs, error: qError } = await query.order('issue_date');
  if (qError) return fail('db', qError.message);
  if (!docs?.length) return fail('empty', 'V období nie je žiadny schválený doklad na export.');
  if (input.documentIds && docs.length !== new Set(input.documentIds).size) {
    return fail('stale', 'Niektoré vybrané doklady sa medzitým zmenili alebo už nie sú schválené. Obnov stránku.');
  }

  const { settings, vatPayer } = await companyExportSettings(supabase, companyId);
  const full = await withLines(supabase, docs as Omit<ExportDocument, 'lines'>[]);
  const problems = full
    .map((d) => ({ id: d.id, label: docLabel(d), errors: checkDocument(d, kind, settings, vatPayer).errors }))
    .filter((p) => p.errors.length);
  if (problems.length) return fail('invalid_documents', `Doklady s chybou: ${problems.length}. Oprav ich alebo ich nevyber.`, problems);

  let xml: string;
  try {
    xml = buildMrpXml(EXPORT_KINDS[kind].agenda, full.map((d) => toMrpInvoice(d, kind, settings, vatPayer)), mrpOptions(settings));
  } catch (e) {
    if (e instanceof MrpExportError) return fail('mrp', e.message);
    throw e;
  }

  const exportId = crypto.randomUUID();
  const fileName = exportFileName(kind, period, exportId);
  const path = `${companyId}/exports/${exportId}.xml`;
  const ids = full.map((d) => d.id);

  const { error: upError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, new Blob([xml], { type: 'application/xml' }), { contentType: 'application/xml', upsert: false });
  if (upError) return fail('storage', upError.message);

  const { error: insError } = await supabase.from('exports').insert({
    id: exportId,
    company_id: companyId,
    target: 'mrp_ks_xml2',
    kind,
    period,
    document_ids: ids,
    status: 'created',
    storage_path: path,
    file_name: fileName,
  });
  if (insError) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return fail('db', insError.message);
  }

  const { data: updated, error: updError } = await supabase
    .from('documents')
    .update({ status: 'exported', export_id: exportId, exported_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'approved')
    .select('id');
  if (updError || (updated ?? []).length !== ids.length) {
    // Niekto medzitým zmenil doklad → vrátiť všetko späť.
    await supabase
      .from('documents')
      .update({ status: 'approved', export_id: null, exported_at: null })
      .eq('export_id', exportId);
    await supabase.from('exports').delete().eq('id', exportId);
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return fail('stale', updError?.message ?? 'Niektoré doklady sa medzitým zmenili. Skús export znova.');
  }

  await supabase.from('document_history').insert(
    ids.map((id) => ({ document_id: id, company_id: companyId, diff: { action: 'exported', export_id: exportId } })),
  );
  return { ok: true, exportId, fileName, count: ids.length };
}

async function loadExport(supabase: Db, companyId: string, exportId: string) {
  const { data } = await supabase
    .from('exports')
    .select('id, company_id, kind, period, status, storage_path, file_name, document_ids, created_at')
    .eq('id', exportId)
    .eq('company_id', companyId)
    .maybeSingle();
  return data;
}

/** Zruší posledný export (ešte nenaimportovaný): doklady sa vrátia do `approved` a odomknú. */
export async function cancelExport(supabase: Db, companyId: string, exportId: string): Promise<ServiceResult> {
  if (!canExport(await memberRole(supabase, companyId))) return fail('forbidden', 'Zrušiť export môže len účtovník firmy.');
  const exp = await loadExport(supabase, companyId, exportId);
  if (!exp) return fail('not_found', 'Export neexistuje.');
  if (exp.status === 'cancelled') return fail('cancelled', 'Export už je zrušený.');
  if (exp.status === 'imported') {
    return fail('imported', 'Export je označený ako naimportovaný v MRP — najprv ho tam zmaž a označ ako chybný.');
  }
  const { data: latest } = await supabase
    .from('exports')
    .select('id')
    .eq('company_id', companyId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id !== exportId) return fail('not_latest', 'Zrušiť sa dá len posledný export.');

  const { count: archived } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('export_id', exportId)
    .eq('status', 'archived');
  if (archived) return fail('archived', 'Niektoré doklady z exportu sú už archivované.');

  const { data: reverted, error } = await supabase
    .from('documents')
    .update({ status: 'approved', export_id: null, exported_at: null })
    .eq('export_id', exportId)
    .eq('status', 'exported')
    .select('id');
  if (error) return fail('db', error.message);
  const { error: expError } = await supabase.from('exports').update({ status: 'cancelled' }).eq('id', exportId);
  if (expError) return fail('db', expError.message);
  if (reverted?.length) {
    await supabase.from('document_history').insert(
      reverted.map((d) => ({ document_id: d.id, company_id: companyId, diff: { action: 'export_cancelled', export_id: exportId } })),
    );
  }
  return { ok: true };
}

/** Ručné označenie výsledku importu v MRP (účtovník). */
export async function setExportStatus(
  supabase: Db,
  companyId: string,
  exportId: string,
  status: 'imported' | 'failed',
  error?: string | null,
): Promise<ServiceResult> {
  if (!canExport(await memberRole(supabase, companyId))) return fail('forbidden', 'Stav exportu mení len účtovník firmy.');
  const exp = await loadExport(supabase, companyId, exportId);
  if (!exp) return fail('not_found', 'Export neexistuje.');
  if (exp.status === 'cancelled') return fail('cancelled', 'Export je zrušený.');
  const { error: upError } = await supabase
    .from('exports')
    .update({ status, error: status === 'failed' ? error?.trim() || null : null })
    .eq('id', exportId);
  return upError ? fail('db', upError.message) : { ok: true };
}

/** Obsah súboru exportu; prvé stiahnutie posunie stav `created → downloaded`. */
export async function downloadExport(
  supabase: Db,
  companyId: string,
  exportId: string,
): Promise<ServiceResult<{ fileName: string; body: Blob }>> {
  const exp = await loadExport(supabase, companyId, exportId);
  if (!exp?.storage_path) return fail('not_found', 'Export neexistuje.');
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(exp.storage_path);
  if (error || !data) return fail('storage', 'Súbor exportu sa nepodarilo načítať.');
  if (exp.status === 'created') {
    await supabase.from('exports').update({ status: 'downloaded' }).eq('id', exportId).eq('status', 'created');
  }
  return { ok: true, fileName: exp.file_name ?? `${exportId}.xml`, body: data };
}

export async function listExports(supabase: Db, companyId: string) {
  const { data } = await supabase
    .from('exports')
    .select('id, kind, period, status, error, file_name, document_ids, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((e) => ({ ...e, count: (e.document_ids as string[] | null)?.length ?? 0 }));
}

export async function saveMrpSettings(supabase: Db, companyId: string, mrp: MrpSettings): Promise<ServiceResult> {
  const role = await memberRole(supabase, companyId);
  if (role !== 'owner' && role !== 'accountant') return fail('forbidden', 'Nastavenie exportu mení majiteľ alebo účtovník.');
  const { data } = await supabase.from('companies').select('settings').eq('id', companyId).maybeSingle();
  const settings = { ...((data?.settings ?? {}) as object), mrp };
  const { error } = await supabase.from('companies').update({ settings }).eq('id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}
