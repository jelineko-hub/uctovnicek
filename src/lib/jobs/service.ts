/**
 * Založenie úloh k dokladu z API/akcií používateľa (RLS klient) + okamžité spustenie na pozadí.
 */
import type { Db } from '../membership';
import { enqueueJob, type EnqueueResult } from './queue';
import { kickJobs } from './runner';

type DocResult = EnqueueResult;

async function unprocessedDoc(db: Db, docId: string) {
  const { data } = await db.from('documents').select('id, company_id, status').eq('id', docId).maybeSingle();
  if (!data) return { error: { ok: false as const, code: 'not_found', error: 'Doklad neexistuje.' } };
  if (data.status !== 'unprocessed') {
    return { error: { ok: false as const, code: 'not_editable', error: 'Spracovať sa dá len nespracovaný doklad.' } };
  }
  return { doc: data as { id: string; company_id: string } };
}

/** Vyťaženie dokladu modelom (`extract`). */
export async function startExtraction(db: Db, docId: string): Promise<DocResult> {
  const { doc, error } = await unprocessedDoc(db, docId);
  if (error) return error;
  const res = await enqueueJob(db, { companyId: doc.company_id, type: 'extract', documentId: doc.id });
  if (res.ok) kickJobs([res.job.id]);
  return res;
}

/** Doplnenie z eKasa podľa UID; `fallbackExtract` = pri chybe vyťažiť z fotky (nahratý bloček s QR). */
export async function startEkasa(db: Db, docId: string, uid: string | null, fallbackExtract = false): Promise<DocResult> {
  const { doc, error } = await unprocessedDoc(db, docId);
  if (error) return error;
  const res = await enqueueJob(db, {
    companyId: doc.company_id,
    type: 'ekasa_lookup',
    documentId: doc.id,
    payload: { uid, fallback_extract: fallbackExtract },
  });
  if (res.ok) kickJobs([res.job.id]);
  return res;
}
