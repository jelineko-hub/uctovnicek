/** Zápis úloh do fronty (`uctovnicek.jobs`). Spracovanie je v `runner.ts`. */
import type { Db } from '../membership';
import { JOB_VIEW_COLUMNS, type JobType, type JobView } from './types';

export type EnqueueResult = { ok: true; job: JobView } | { ok: false; code: string; error: string };

/**
 * Založí úlohu. S klientom používateľa platí RLS (len kto smie meniť doklady firmy), so service role nie.
 * Pre doklad sa nezakladá druhá rovnaká úloha, kým prvá čaká alebo beží — vráti sa existujúca.
 */
export async function enqueueJob(
  db: Db,
  input: { companyId: string; type: JobType; documentId?: string | null; payload?: Record<string, unknown> },
): Promise<EnqueueResult> {
  if (input.documentId) {
    const { data: active } = await db
      .from('jobs')
      .select(JOB_VIEW_COLUMNS)
      .eq('document_id', input.documentId)
      .eq('type', input.type)
      .in('status', ['pending', 'running'])
      .limit(1)
      .maybeSingle();
    if (active) return { ok: true, job: active as JobView };
  }
  const { data, error } = await db
    .from('jobs')
    .insert({
      company_id: input.companyId,
      type: input.type,
      document_id: input.documentId ?? null,
      payload: input.payload ?? {},
    })
    .select(JOB_VIEW_COLUMNS)
    .single();
  if (error) {
    return error.code === '42501'
      ? { ok: false, code: 'forbidden', error: 'Na túto akciu nemáš oprávnenie.' }
      : { ok: false, code: 'db', error: error.message };
  }
  return { ok: true, job: data as JobView };
}

export async function getJob(db: Db, id: string): Promise<JobView | null> {
  const { data } = await db.from('jobs').select(JOB_VIEW_COLUMNS).eq('id', id).maybeSingle();
  return (data as JobView | null) ?? null;
}

/** Posledná úloha dokladu (pre editor: beží vyťaženie? zlyhalo?). */
export async function latestDocumentJob(db: Db, documentId: string): Promise<JobView | null> {
  const { data } = await db
    .from('jobs')
    .select(JOB_VIEW_COLUMNS)
    .eq('document_id', documentId)
    .in('type', ['extract', 'ekasa_lookup'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobView | null) ?? null;
}
