/**
 * Doplnenie bločku z eKasa: UID → lookup → prepíše hlavičku, partnera a položky dokladu (eKasa má prednosť pred OCR).
 * Volá ho API `/api/documents/:id/ekasa`, vyťaženie (keď model prečíta UID) aj nahrávanie s QR kódom.
 * Beží ako úloha `ekasa_lookup` (`lib/jobs/runner.ts`), pri vyťažení aj priamo v rámci úlohy `extract`.
 */
import { applyAccountingRules } from '../accounting/service';
import { refreshDuplicateOf } from '../duplicates';
import type { Db } from '../membership';
import { lookupEkasaReceipt } from './lookup';
import { ekasaToDocument } from './toDocument';
import { normalizeEkasaUid } from './uid';

export type EkasaApplyResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: 'not_found' | 'unavailable' | 'invalid_uid' | 'not_editable' | 'db'; error: string };

export async function applyEkasa(supabase: Db, docId: string, uidInput?: string | null): Promise<EkasaApplyResult> {
  const { data: doc } = await supabase
    .from('documents')
    .select('id, company_id, status, ekasa_uid')
    .eq('id', docId)
    .maybeSingle();
  if (!doc) return { ok: false, code: 'not_editable', error: 'Doklad neexistuje.' };
  if (doc.status !== 'unprocessed') {
    return { ok: false, code: 'not_editable', error: 'Z eKasa sa dá doplniť len nespracovaný doklad.' };
  }
  const uid = normalizeEkasaUid(uidInput ?? doc.ekasa_uid);
  if (!uid) return { ok: false, code: 'invalid_uid', error: 'Neplatné UID bločku (očakáva sa O- a 32 znakov).' };
  if (uid !== doc.ekasa_uid) await supabase.from('documents').update({ ekasa_uid: uid }).eq('id', docId);

  const found = await lookupEkasaReceipt(uid);
  if (!found.ok) return { ok: false, code: found.code, error: found.message };

  const { patch, lines, vatSummary, warnings } = ekasaToDocument(found.receipt);
  const { error } = await supabase
    .from('documents')
    .update({
      ...patch,
      ekasa_data: found.receipt,
      ocr_raw: { source: 'ekasa', vat_summary: vatSummary, notes: warnings.join(' ') || null },
    })
    .eq('id', docId);
  if (error) return { ok: false, code: 'db', error: error.message };

  await supabase.from('document_lines').delete().eq('document_id', docId);
  if (lines.length) {
    const { error: lineError } = await supabase
      .from('document_lines')
      .insert(lines.map((l) => ({ ...l, document_id: docId, company_id: doc.company_id })));
    if (lineError) return { ok: false, code: 'db', error: lineError.message };
  }
  await supabase.from('document_history').insert({
    document_id: docId,
    company_id: doc.company_id,
    diff: { action: 'ekasa', uid },
  });
  await refreshDuplicateOf(supabase, docId);
  await applyAccountingRules(supabase, docId);
  return { ok: true, warnings };
}
